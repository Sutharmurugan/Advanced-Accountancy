import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsString } from 'class-validator';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { ReportsService } from '../accounting/reports/reports.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateConsolidationRunDto {
  @IsString() businessGroupId: string;
  @IsString() periodLabel: string;
  @IsString() presentationCurrency: string;
  @IsDateString() asOfDate: string;
}

/**
 * Each company keeps its own untouched books (section I) — a consolidation
 * run only reads gl_account_balances (via ReportsService.trialBalance) per
 * company in the group, translates to the presentation currency using
 * that company's configured exchange rate, and writes its own output rows.
 * Nothing here ever posts back into a subsidiary's ledger.
 *
 * Elimination: a company that trades with another group company is
 * expected to tag one account controlType = 'INTERCOMPANY' (its
 * Intercompany Receivable/Payable). Every 'matched' IntercompanyTransaction
 * touching that company reduces that account's translated balance by the
 * transaction amount — a deliberately narrow, explainable elimination
 * rather than an attempt to auto-detect which of a company's many accounts
 * an intercompany trade touched.
 */
@Injectable()
export class ConsolidationRunsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  list(tenantId: string, businessGroupId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.consolidationRun.findMany({
        where: businessGroupId ? { businessGroupId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const run = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.consolidationRun.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!run) throw new NotFoundException('Consolidation run not found');
    return run;
  }

  /** Groups the run's per-company lines into one consolidated total per
   * account code — the actual "Consolidated Trial Balance". */
  async consolidatedSummary(tenantId: string, id: string) {
    const run = await this.get(tenantId, id);
    const byAccountCode = new Map<
      string,
      { accountCode: string; accountName: string; misCategory: string | null; total: number }
    >();
    for (const line of run.lines) {
      const key = line.accountCode;
      const existing = byAccountCode.get(key);
      const amount = Number(line.translatedAmount) + Number(line.eliminationAmount);
      if (existing) {
        existing.total += amount;
      } else {
        byAccountCode.set(key, {
          accountCode: line.accountCode,
          accountName: line.accountName,
          misCategory: line.misCategory,
          total: amount,
        });
      }
    }
    return [...byAccountCode.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode));
  }

  create(tenantId: string, userId: string, dto: CreateConsolidationRunDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const companies = await tx.company.findMany({
        where: { businessGroupId: dto.businessGroupId },
      });
      if (companies.length === 0) {
        throw new BadRequestException('No companies belong to this business group');
      }

      const run = await tx.consolidationRun.create({
        data: {
          tenantId,
          businessGroupId: dto.businessGroupId,
          periodLabel: dto.periodLabel,
          presentationCurrency: dto.presentationCurrency,
        },
      });

      const matchedTxns = await tx.intercompanyTransaction.findMany({
        where: { businessGroupId: dto.businessGroupId, status: 'matched' },
      });

      for (const company of companies) {
        const trialBalance = await this.reports.trialBalance(tenantId, company.id, dto.asOfDate);
        const fxRate = await this.resolveRate(
          tx,
          company.id,
          company.baseCurrencyCode,
          dto.presentationCurrency,
          dto.asOfDate,
        );

        const intercompanyAccount = await tx.chartOfAccount.findFirst({
          where: { companyId: company.id, controlType: 'INTERCOMPANY' },
        });
        const eliminationTotal = matchedTxns
          .filter((t) => t.companyAId === company.id || t.companyBId === company.id)
          .reduce((sum, t) => sum - Number(t.amount), 0); // netted out, so it reduces the balance

        for (const row of trialBalance) {
          const translatedAmount = row.balance * fxRate;
          const isIntercompanyAccount =
            intercompanyAccount && row.accountCode === intercompanyAccount.accountCode;
          const eliminationAmount = isIntercompanyAccount ? eliminationTotal * fxRate : 0;

          await tx.consolidatedTrialBalanceLine.create({
            data: {
              consolidationRunId: run.id,
              companyId: company.id,
              accountCode: row.accountCode,
              accountName: row.name,
              misCategory: row.misCategory,
              originalAmount: row.balance,
              translatedAmount,
              eliminationAmount,
            },
          });
        }
      }

      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'create',
        entityType: 'consolidation_run',
        entityId: run.id,
        newValue: { businessGroupId: dto.businessGroupId, periodLabel: dto.periodLabel },
      });

      return tx.consolidationRun.findUnique({ where: { id: run.id }, include: { lines: true } });
    });
  }

  async finalize(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const run = await tx.consolidationRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Consolidation run not found');
      if (run.status === 'final') {
        throw new BadRequestException('Run is already final');
      }

      const unmatched = await tx.intercompanyTransaction.findMany({
        where: { businessGroupId: run.businessGroupId, status: 'unmatched' },
      });
      if (unmatched.length > 0) {
        throw new BadRequestException(
          `Cannot finalize: ${unmatched.length} unmatched intercompany transaction(s) for this group`,
        );
      }

      const updated = await tx.consolidationRun.update({
        where: { id },
        data: { status: 'final', finalizedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'approve',
        entityType: 'consolidation_run',
        entityId: id,
      });
      return updated;
    });
  }

  private async resolveRate(
    tx: Prisma.TransactionClient,
    companyId: string,
    fromCurrency: string,
    toCurrency: string,
    asOfDate: string,
  ): Promise<number> {
    if (fromCurrency === toCurrency) return 1;
    const rate = await tx.exchangeRate.findFirst({
      where: { companyId, fromCurrency, toCurrency, rateDate: { lte: new Date(asOfDate) } },
      orderBy: { rateDate: 'desc' },
    });
    if (!rate) {
      throw new BadRequestException(
        `No exchange rate configured for ${fromCurrency} -> ${toCurrency} on or before ${asOfDate}`,
      );
    }
    return Number(rate.rate);
  }
}

@Controller('consolidation-runs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ConsolidationRunsController {
  constructor(private readonly consolidationRuns: ConsolidationRunsService) {}

  @Get()
  @RequirePermissions('consolidation.read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('businessGroupId') businessGroupId?: string,
  ) {
    return this.consolidationRuns.list(user.tenantId, businessGroupId);
  }

  @Get(':id')
  @RequirePermissions('consolidation.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.consolidationRuns.get(user.tenantId, id);
  }

  @Get(':id/summary')
  @RequirePermissions('consolidation.read')
  summary(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.consolidationRuns.consolidatedSummary(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('consolidation.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateConsolidationRunDto) {
    return this.consolidationRuns.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/finalize')
  @RequirePermissions('consolidation.manage')
  finalize(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.consolidationRuns.finalize(user.tenantId, user.userId, id);
  }
}
