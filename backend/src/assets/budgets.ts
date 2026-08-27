import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class BudgetLineDto {
  @IsString() accountId: string;
  @IsInt() @Min(1) @Max(12) periodNo: number;
  @IsOptional() @IsString() costCentreId?: string;
  @IsNumber() amount: number;
}

export class CreateBudgetDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsString() fiscalYearId: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}

/**
 * Budgets are compared against gl_account_balances at report time (MIS
 * Actual vs. Budget, section H) — they are not a parallel ledger, just a
 * named series of amounts keyed the same way GL balances are (account x
 * period x cost centre).
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.budget.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateBudgetDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const budget = await tx.budget.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          name: dto.name,
          fiscalYearId: dto.fiscalYearId,
          lines: {
            create: dto.lines.map((l) => ({
              accountId: l.accountId,
              periodNo: l.periodNo,
              costCentreId: l.costCentreId,
              amount: l.amount,
            })),
          },
        },
        include: { lines: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'budget',
        entityId: budget.id,
        newValue: { name: dto.name, lineCount: dto.lines.length },
      });
      return budget;
    });
  }

  /** Actual vs. Budget for one budget's fiscal year, per account. */
  async varianceReport(tenantId: string, budgetId: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const budget = await tx.budget.findUniqueOrThrow({
        where: { id: budgetId },
        include: { lines: true },
      });

      const budgetByAccount = new Map<string, number>();
      for (const line of budget.lines) {
        budgetByAccount.set(
          line.accountId,
          (budgetByAccount.get(line.accountId) ?? 0) + Number(line.amount),
        );
      }

      const actuals = await tx.$queryRaw<{ account_id: string; debit_total: string; credit_total: string }[]>`
        SELECT gab.account_id, SUM(gab.debit_total) AS debit_total, SUM(gab.credit_total) AS credit_total
        FROM gl_account_balances gab
        JOIN accounting_periods ap ON ap.id = gab.accounting_period_id
        WHERE ap.fiscal_year_id = ${budget.fiscalYearId}
        GROUP BY gab.account_id
      `;
      const actualByAccount = new Map(
        actuals.map((a) => [a.account_id, Number(a.debit_total) - Number(a.credit_total)]),
      );

      const accountIds = new Set([...budgetByAccount.keys(), ...actualByAccount.keys()]);
      const accounts = await tx.chartOfAccount.findMany({ where: { id: { in: [...accountIds] } } });
      const accountById = new Map(accounts.map((a) => [a.id, a]));

      return [...accountIds].map((accountId) => {
        const budgeted = budgetByAccount.get(accountId) ?? 0;
        const actual = actualByAccount.get(accountId) ?? 0;
        const variance = actual - budgeted;
        return {
          accountCode: accountById.get(accountId)?.accountCode,
          accountName: accountById.get(accountId)?.name,
          budgeted,
          actual,
          variance,
          variancePercent: budgeted !== 0 ? (variance / Math.abs(budgeted)) * 100 : null,
        };
      });
    });
  }
}

@Controller('budgets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('budget.manage')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.budgets.list(user.tenantId, companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(user.tenantId, user.userId, dto);
  }

  @Get(':id/variance')
  variance(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.budgets.varianceReport(user.tenantId, id);
  }
}
