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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { MatchingEngineService } from './matching-engine.service';
import { CustomerReceiptsService } from '../sales/customer-receipts';
import { SupplierPaymentsService } from '../purchasing/supplier-payments';

export class BankStatementLineInputDto {
  @IsDateString() transactionDate: string;
  @IsString() description: string;
  /** Signed: positive = money in, negative = money out. */
  @IsNumber() amount: number;
}

export class ImportBankStatementDto {
  @IsString() companyId: string;
  @IsString() bankAccountId: string;
  @IsDateString() statementDate: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BankStatementLineInputDto)
  lines: BankStatementLineInputDto[];
}

/**
 * Bank reconciliation (section 9): import a statement, score each line
 * against open invoices via MatchingEngineService, and let a human approve
 * a suggestion (which books the actual receipt/payment) or ignore a line.
 *
 * approveMatch composes CustomerReceiptsService/SupplierPaymentsService —
 * each of those already opens and commits its own transaction (create,
 * then post), so this is a short sequence of independently-committed steps
 * rather than one atomic transaction. Each step lands in a valid state on
 * its own (a posted receipt is never invalid); the one gap is a crash
 * between "receipt posted" and "bank line marked reconciled", which would
 * need a manual re-check rather than being automatically impossible.
 */
@Injectable()
export class BankStatementsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly matchingEngine: MatchingEngineService,
    private readonly customerReceipts: CustomerReceiptsService,
    private readonly supplierPayments: SupplierPaymentsService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.bankStatement.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { importedAt: 'desc' },
      }),
    );
  }

  import(tenantId: string, userId: string, dto: ImportBankStatementDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const statement = await tx.bankStatement.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          bankAccountId: dto.bankAccountId,
          statementDate: new Date(dto.statementDate),
          lines: {
            create: dto.lines.map((l, idx) => ({
              lineNo: idx + 1,
              transactionDate: new Date(l.transactionDate),
              description: l.description,
              amount: l.amount,
            })),
          },
        },
        include: { lines: true },
      });

      for (const line of statement.lines) {
        const suggestion = await this.matchingEngine.suggest(
          tx,
          dto.companyId,
          line.description,
          Number(line.amount),
        );
        if (suggestion) {
          await tx.bankStatementLine.update({
            where: { id: line.id },
            data: {
              status: 'suggested',
              suggestedType: suggestion.suggestedType,
              suggestedCustomerId: suggestion.suggestedCustomerId,
              suggestedSupplierId: suggestion.suggestedSupplierId,
              suggestedInvoiceId: suggestion.suggestedInvoiceId,
              confidenceScore: suggestion.confidenceScore,
            },
          });
        }
      }

      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'bank_statement',
        entityId: statement.id,
        newValue: { lineCount: statement.lines.length },
      });

      return tx.bankStatement.findUnique({
        where: { id: statement.id },
        include: { lines: true },
      });
    });
  }

  async approveMatch(tenantId: string, userId: string, lineId: string) {
    const line = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.bankStatementLine.findUnique({
        where: { id: lineId },
        include: { bankStatement: true },
      }),
    );
    if (!line) throw new NotFoundException('Bank statement line not found');
    if (line.status !== 'suggested' || !line.suggestedInvoiceId) {
      throw new BadRequestException('Line has no suggested match to approve');
    }

    const statement = line.bankStatement;
    let journalEntryId: string;

    if (line.suggestedType === 'customer_receipt') {
      const receipt = await this.customerReceipts.create(tenantId, userId, {
        companyId: statement.companyId,
        customerId: line.suggestedCustomerId!,
        bankAccountId: statement.bankAccountId,
        receiptDate: line.transactionDate.toISOString().slice(0, 10),
        allocations: [{ salesInvoiceId: line.suggestedInvoiceId, amount: Number(line.amount) }],
      });
      const posted = await this.customerReceipts.post(tenantId, userId, receipt.id);
      journalEntryId = posted.journalEntryId!;
    } else if (line.suggestedType === 'supplier_payment') {
      const payment = await this.supplierPayments.create(tenantId, userId, {
        companyId: statement.companyId,
        supplierId: line.suggestedSupplierId!,
        bankAccountId: statement.bankAccountId,
        paymentDate: line.transactionDate.toISOString().slice(0, 10),
        allocations: [{ supplierInvoiceId: line.suggestedInvoiceId, amount: -Number(line.amount) }],
      });
      const posted = await this.supplierPayments.post(tenantId, userId, payment.id);
      journalEntryId = posted.journalEntryId!;
    } else {
      throw new BadRequestException('Unknown suggested match type');
    }

    return this.tenantPrisma.run(tenantId, async (tx) => {
      const reconciled = await tx.bankStatementLine.update({
        where: { id: lineId },
        data: {
          status: 'reconciled',
          matchedJournalEntryId: journalEntryId,
          reconciledAt: new Date(),
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: statement.companyId,
        userId,
        action: 'post',
        entityType: 'bank_statement_line',
        entityId: lineId,
        newValue: { journalEntryId },
      });
      return reconciled;
    });
  }

  async ignoreLine(tenantId: string, userId: string, lineId: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const line = await tx.bankStatementLine.findUnique({ where: { id: lineId } });
      if (!line) throw new NotFoundException('Bank statement line not found');
      const updated = await tx.bankStatementLine.update({
        where: { id: lineId },
        data: { status: 'ignored' },
      });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'edit',
        entityType: 'bank_statement_line',
        entityId: lineId,
        newValue: { status: 'ignored' },
      });
      return updated;
    });
  }
}

@Controller('bank-statements')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BankStatementsController {
  constructor(private readonly bankStatements: BankStatementsService) {}

  @Get()
  @RequirePermissions('banking.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.bankStatements.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('banking.manage')
  import(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportBankStatementDto) {
    return this.bankStatements.import(user.tenantId, user.userId, dto);
  }

  @Post('lines/:id/approve')
  @RequirePermissions('banking.manage')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bankStatements.approveMatch(user.tenantId, user.userId, id);
  }

  @Post('lines/:id/ignore')
  @RequirePermissions('banking.manage')
  ignore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bankStatements.ignoreLine(user.tenantId, user.userId, id);
  }
}
