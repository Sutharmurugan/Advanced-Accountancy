import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { NumberingService } from '../numbering.service';
import { AccountingEngineService } from '../accounting-engine.service';
import { CreateJournalEntryDto } from './journal-entries.dto';

const BALANCE_TOLERANCE = 0.01;

/**
 * Manual journal entries follow the full
 * Draft -> Submitted -> Approved -> Posted lifecycle from section D,
 * distinct from the module-triggered postEvent() path (which posts
 * synchronously and skips straight to Posted). This is the entry point
 * accountants use for adjusting/correcting entries.
 */
@Injectable()
export class JournalEntriesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.journalEntry.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const entry = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.journalEntry.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  create(tenantId: string, userId: string, dto: CreateJournalEntryDto) {
    const totalDebit = dto.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const totalCredit = dto.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
      throw new BadRequestException(
        `Entry is not balanced: total debit ${totalDebit} != total credit ${totalCredit}`,
      );
    }
    if (dto.lines.some((l) => (l.debit ?? 0) > 0 && (l.credit ?? 0) > 0)) {
      throw new BadRequestException('A line cannot have both a debit and a credit');
    }

    return this.tenantPrisma.run(tenantId, async (tx) => {
      const entryDate = new Date(dto.entryDate);
      const period = await tx.accountingPeriod.findFirst({
        where: {
          fiscalYear: { companyId: dto.companyId },
          startDate: { lte: entryDate },
          endDate: { gte: entryDate },
        },
      });
      if (!period) {
        throw new BadRequestException('No accounting period covers this entry date');
      }

      const entryNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'JOURNAL_ENTRY',
        'JE-',
      );

      const entry = await tx.journalEntry.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          accountingPeriodId: period.id,
          entryNumber,
          sourceModule: 'MANUAL',
          entryDate,
          currencyCode: dto.currencyCode,
          status: 'draft',
          description: dto.description,
          createdBy: userId,
          lines: {
            create: dto.lines.map((l, idx) => ({
              lineNo: idx + 1,
              accountId: l.accountId,
              debit: l.debit ?? 0,
              credit: l.credit ?? 0,
              baseCurrencyAmount: (l.debit ?? 0) - (l.credit ?? 0),
              description: l.description,
              departmentId: l.departmentId,
              costCentreId: l.costCentreId,
              profitCentreId: l.profitCentreId,
              projectId: l.projectId,
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
        entityType: 'journal_entry',
        entityId: entry.id,
        newValue: { entryNumber, totalDebit, totalCredit },
      });
      return entry;
    });
  }

  submit(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, 'draft', 'submitted', 'edit');
  }

  approve(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, 'submitted', 'approved', 'approve');
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const entry = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== 'approved') {
        throw new BadRequestException('Only an approved entry can be posted');
      }

      const period = await tx.accountingPeriod.findUnique({
        where: { id: entry.accountingPeriodId },
      });
      if (!period || period.status !== 'open') {
        throw new BadRequestException('The accounting period for this entry is not open');
      }

      const posted = await tx.journalEntry.update({
        where: { id },
        data: { status: 'posted', postedAt: new Date() },
        include: { lines: true },
      });

      for (const line of posted.lines) {
        await tx.glAccountBalance.upsert({
          where: {
            gl_balance_key: {
              companyId: posted.companyId,
              accountingPeriodId: posted.accountingPeriodId,
              accountId: line.accountId,
              branchId: posted.branchId ?? '',
              departmentId: line.departmentId ?? '',
              costCentreId: line.costCentreId ?? '',
              profitCentreId: line.profitCentreId ?? '',
            },
          },
          create: {
            tenantId,
            companyId: posted.companyId,
            accountingPeriodId: posted.accountingPeriodId,
            accountId: line.accountId,
            branchId: posted.branchId ?? '',
            departmentId: line.departmentId ?? '',
            costCentreId: line.costCentreId ?? '',
            profitCentreId: line.profitCentreId ?? '',
            debitTotal: line.debit,
            creditTotal: line.credit,
          },
          update: {
            debitTotal: { increment: line.debit },
            creditTotal: { increment: line.credit },
          },
        });
      }

      await this.audit.record(tx, {
        tenantId,
        companyId: posted.companyId,
        userId,
        action: 'post',
        entityType: 'journal_entry',
        entityId: id,
      });
      return posted;
    });
  }

  async reverse(tenantId: string, userId: string, id: string, reversalDate?: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const reversal = await this.engine.reverse(
        tx,
        tenantId,
        id,
        reversalDate ? new Date(reversalDate) : new Date(),
        userId,
      );
      await this.audit.record(tx, {
        tenantId,
        companyId: reversal.companyId,
        userId,
        action: 'reverse',
        entityType: 'journal_entry',
        entityId: id,
        newValue: { reversalEntryId: reversal.id },
      });
      return reversal;
    });
  }

  private transition(
    tenantId: string,
    userId: string,
    id: string,
    from: string,
    to: string,
    auditAction: 'edit' | 'approve',
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const entry = await tx.journalEntry.findUnique({ where: { id } });
      if (!entry) throw new NotFoundException('Journal entry not found');
      if (entry.status !== from) {
        throw new BadRequestException(`Entry must be ${from} to transition to ${to}`);
      }
      const updated = await tx.journalEntry.update({
        where: { id },
        data: { status: to },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: entry.companyId,
        userId,
        action: auditAction,
        entityType: 'journal_entry',
        entityId: id,
        oldValue: { status: from },
        newValue: { status: to },
      });
      return updated;
    });
  }
}
