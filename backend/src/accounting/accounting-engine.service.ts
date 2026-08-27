import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { NumberingService } from './numbering.service';

export interface PostEventParams {
  tenantId: string;
  companyId: string;
  branchId?: string;
  eventType: string;
  entryDate: Date;
  currencyCode: string;
  exchangeRate?: number;
  sourceModule: string;
  sourceDocType: string;
  sourceDocId: string;
  description?: string;
  /** Business amounts a posting rule's lines pull from, e.g. { subtotal, taxAmount, total }. */
  amounts: Record<string, number | Prisma.Decimal>;
  /** Resolves "OVERRIDE:<key>" account resolvers — an accountId per key. */
  accountOverrides?: Record<string, string>;
  dimensions?: {
    departmentId?: string;
    costCentreId?: string;
    profitCentreId?: string;
    projectId?: string;
    customerId?: string;
    supplierId?: string;
    taxCodeId?: string;
  };
  createdBy?: string;
}

const BALANCE_TOLERANCE = 0.01;

/**
 * The Central Accounting Engine (docs/architecture/00-OMNIERP-ARCHITECTURE.md,
 * section D). This is the ONLY place that writes a posted journal_entries
 * row. Every module — Sales, Purchasing, Inventory, Payroll, Assets — calls
 * postEvent() with business facts; which GL accounts actually get hit is
 * decided entirely by that company's configured PostingRule (data), never by
 * module code. That is what keeps double-entry logic in one place.
 *
 * Module-triggered events post synchronously and immediately (status =
 * posted) in the same transaction as the caller's own document status
 * change — see the sync-vs-async note in section D. Manual journal entries
 * go through the separate draft -> submitted -> approved -> posted workflow
 * in JournalEntriesService instead of this method.
 */
@Injectable()
export class AccountingEngineService {
  constructor(private readonly numbering: NumberingService) {}

  async postEvent(tx: Prisma.TransactionClient, params: PostEventParams) {
    const rule = await tx.postingRule.findUnique({
      where: {
        companyId_eventType: {
          companyId: params.companyId,
          eventType: params.eventType,
        },
      },
      include: { lines: { orderBy: { lineNo: 'asc' } } },
    });
    if (!rule || !rule.isActive) {
      throw new BadRequestException(
        `No active posting rule configured for event "${params.eventType}" on this company`,
      );
    }

    const period = await tx.accountingPeriod.findFirst({
      where: {
        fiscalYear: { companyId: params.companyId },
        startDate: { lte: params.entryDate },
        endDate: { gte: params.entryDate },
      },
    });
    if (!period) {
      throw new BadRequestException(
        `No accounting period covers ${params.entryDate.toISOString().slice(0, 10)} for this company`,
      );
    }
    if (period.status !== 'open') {
      throw new BadRequestException(
        `Accounting period covering ${params.entryDate.toISOString().slice(0, 10)} is ${period.status}, not open`,
      );
    }

    const lineInputs: {
      lineNo: number;
      accountId: string;
      debit: number;
      credit: number;
    }[] = [];

    for (const ruleLine of rule.lines) {
      const rawAmount = params.amounts[ruleLine.amountSource];
      const amount =
        rawAmount === undefined || rawAmount === null
          ? 0
          : Number(rawAmount);
      if (amount === 0) continue; // e.g. a zero-tax invoice skips the tax line entirely

      const accountId = await this.resolveAccount(
        tx,
        params.companyId,
        ruleLine.accountResolver,
        params.accountOverrides,
      );

      lineInputs.push({
        lineNo: ruleLine.lineNo,
        accountId,
        debit: ruleLine.side === 'debit' ? amount : 0,
        credit: ruleLine.side === 'credit' ? amount : 0,
      });
    }

    const totalDebit = lineInputs.reduce((sum, l) => sum + l.debit, 0);
    const totalCredit = lineInputs.reduce((sum, l) => sum + l.credit, 0);
    if (Math.abs(totalDebit - totalCredit) > BALANCE_TOLERANCE) {
      throw new InternalServerErrorException(
        `Posting rule "${params.eventType}" produced an unbalanced entry: debit ${totalDebit} != credit ${totalCredit}`,
      );
    }

    const entryNumber = await this.numbering.next(
      tx,
      params.companyId,
      params.tenantId,
      'JOURNAL_ENTRY',
      'JE-',
    );

    const entry = await tx.journalEntry.create({
      data: {
        tenantId: params.tenantId,
        companyId: params.companyId,
        branchId: params.branchId,
        accountingPeriodId: period.id,
        postingRuleId: rule.id,
        entryNumber,
        sourceModule: params.sourceModule,
        sourceDocType: params.sourceDocType,
        sourceDocId: params.sourceDocId,
        entryDate: params.entryDate,
        currencyCode: params.currencyCode,
        exchangeRate: params.exchangeRate ?? 1,
        status: 'posted',
        description: params.description,
        createdBy: params.createdBy,
        postedAt: new Date(),
        lines: {
          create: lineInputs.map((l) => ({
            lineNo: l.lineNo,
            accountId: l.accountId,
            debit: l.debit,
            credit: l.credit,
            baseCurrencyAmount: l.debit - l.credit,
            departmentId: params.dimensions?.departmentId,
            costCentreId: params.dimensions?.costCentreId,
            profitCentreId: params.dimensions?.profitCentreId,
            projectId: params.dimensions?.projectId,
            customerId: params.dimensions?.customerId,
            supplierId: params.dimensions?.supplierId,
            taxCodeId: params.dimensions?.taxCodeId,
          })),
        },
      },
      include: { lines: true },
    });

    for (const line of entry.lines) {
      await this.updateGlBalance(tx, {
        tenantId: params.tenantId,
        companyId: params.companyId,
        accountingPeriodId: period.id,
        accountId: line.accountId,
        branchId: params.branchId ?? '',
        departmentId: line.departmentId ?? '',
        costCentreId: line.costCentreId ?? '',
        profitCentreId: line.profitCentreId ?? '',
        debit: Number(line.debit),
        credit: Number(line.credit),
      });
    }

    return entry;
  }

  /**
   * Reverses a posted journal entry with an exact mirror entry (debits and
   * credits swapped), linked via reversalOfId — never an UPDATE on the
   * original row (which the database trigger would reject anyway).
   */
  async reverse(
    tx: Prisma.TransactionClient,
    tenantId: string,
    journalEntryId: string,
    reversalDate: Date,
    createdBy?: string,
  ) {
    const original = await tx.journalEntry.findUnique({
      where: { id: journalEntryId },
      include: { lines: true },
    });
    if (!original) throw new BadRequestException('Journal entry not found');
    if (original.status !== 'posted') {
      throw new BadRequestException('Only a posted journal entry can be reversed');
    }

    const period = await tx.accountingPeriod.findFirst({
      where: {
        fiscalYear: { companyId: original.companyId },
        startDate: { lte: reversalDate },
        endDate: { gte: reversalDate },
      },
    });
    if (!period || period.status !== 'open') {
      throw new BadRequestException('No open accounting period for the reversal date');
    }

    const entryNumber = await this.numbering.next(
      tx,
      original.companyId,
      tenantId,
      'JOURNAL_ENTRY',
      'JE-',
    );

    const reversal = await tx.journalEntry.create({
      data: {
        tenantId,
        companyId: original.companyId,
        branchId: original.branchId,
        accountingPeriodId: period.id,
        entryNumber,
        sourceModule: original.sourceModule,
        sourceDocType: original.sourceDocType,
        sourceDocId: original.sourceDocId,
        entryDate: reversalDate,
        currencyCode: original.currencyCode,
        exchangeRate: original.exchangeRate,
        status: 'posted',
        reversalOfId: original.id,
        description: `Reversal of ${original.entryNumber}`,
        createdBy,
        postedAt: new Date(),
        lines: {
          create: original.lines.map((l) => ({
            lineNo: l.lineNo,
            accountId: l.accountId,
            debit: l.credit,
            credit: l.debit,
            baseCurrencyAmount: -Number(l.baseCurrencyAmount),
            departmentId: l.departmentId,
            costCentreId: l.costCentreId,
            profitCentreId: l.profitCentreId,
            projectId: l.projectId,
            customerId: l.customerId,
            supplierId: l.supplierId,
            taxCodeId: l.taxCodeId,
          })),
        },
      },
      include: { lines: true },
    });

    await tx.journalEntry.update({
      where: { id: original.id },
      data: { status: 'reversed' },
    });

    for (const line of reversal.lines) {
      await this.updateGlBalance(tx, {
        tenantId,
        companyId: original.companyId,
        accountingPeriodId: period.id,
        accountId: line.accountId,
        branchId: original.branchId ?? '',
        departmentId: line.departmentId ?? '',
        costCentreId: line.costCentreId ?? '',
        profitCentreId: line.profitCentreId ?? '',
        debit: Number(line.debit),
        credit: Number(line.credit),
      });
    }

    return reversal;
  }

  private async resolveAccount(
    tx: Prisma.TransactionClient,
    companyId: string,
    resolver: string,
    overrides?: Record<string, string>,
  ): Promise<string> {
    if (resolver.startsWith('CONTROL:')) {
      const controlType = resolver.slice('CONTROL:'.length);
      const account = await tx.chartOfAccount.findFirst({
        where: { companyId, controlType, isActive: true },
      });
      if (!account) {
        throw new BadRequestException(
          `No active account tagged controlType=${controlType} configured for this company`,
        );
      }
      return account.id;
    }

    if (resolver.startsWith('OVERRIDE:')) {
      const key = resolver.slice('OVERRIDE:'.length);
      const accountId = overrides?.[key];
      if (!accountId) {
        throw new BadRequestException(
          `Posting event is missing required account override "${key}"`,
        );
      }
      const account = await tx.chartOfAccount.findFirst({
        where: { id: accountId, companyId },
      });
      if (!account) {
        throw new BadRequestException(
          `Account override "${key}" (${accountId}) does not belong to this company`,
        );
      }
      return account.id;
    }

    throw new InternalServerErrorException(
      `Unknown account resolver syntax: "${resolver}"`,
    );
  }

  private async updateGlBalance(
    tx: Prisma.TransactionClient,
    key: {
      tenantId: string;
      companyId: string;
      accountingPeriodId: string;
      accountId: string;
      branchId: string;
      departmentId: string;
      costCentreId: string;
      profitCentreId: string;
      debit: number;
      credit: number;
    },
  ) {
    await tx.glAccountBalance.upsert({
      where: {
        gl_balance_key: {
          companyId: key.companyId,
          accountingPeriodId: key.accountingPeriodId,
          accountId: key.accountId,
          branchId: key.branchId,
          departmentId: key.departmentId,
          costCentreId: key.costCentreId,
          profitCentreId: key.profitCentreId,
        },
      },
      create: {
        tenantId: key.tenantId,
        companyId: key.companyId,
        accountingPeriodId: key.accountingPeriodId,
        accountId: key.accountId,
        branchId: key.branchId,
        departmentId: key.departmentId,
        costCentreId: key.costCentreId,
        profitCentreId: key.profitCentreId,
        debitTotal: key.debit,
        creditTotal: key.credit,
      },
      update: {
        debitTotal: { increment: key.debit },
        creditTotal: { increment: key.credit },
      },
    });
  }
}
