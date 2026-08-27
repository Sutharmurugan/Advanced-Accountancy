import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

interface AccountBalanceRow {
  account_code: string;
  name: string;
  account_type: string;
  mis_category: string | null;
  debit_total: string;
  credit_total: string;
}

/**
 * Reads gl_account_balances (the incrementally maintained summary the
 * Accounting Engine keeps up to date) rather than summing raw
 * journal_entry_lines, so report latency doesn't degrade as the ledger
 * grows (section H). No separate year-end closing journal is posted in
 * this phase — reports are computed by date-range aggregation instead,
 * which is the simplification called out in backend/README.md.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  trialBalance(tenantId: string, companyId: string, asOfDate: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<AccountBalanceRow[]>`
        SELECT coa.account_code, coa.name, coa.account_type, coa.mis_category,
               SUM(gab.debit_total) AS debit_total, SUM(gab.credit_total) AS credit_total
        FROM gl_account_balances gab
        JOIN chart_of_accounts coa ON coa.id = gab.account_id
        JOIN accounting_periods ap ON ap.id = gab.accounting_period_id
        WHERE gab.company_id = ${companyId} AND ap.end_date <= ${asOfDate}::date
        GROUP BY coa.account_code, coa.name, coa.account_type, coa.mis_category
        ORDER BY coa.account_code
      `;
      return rows.map(mapAccountRow);
    });
  }

  balanceSheet(tenantId: string, companyId: string, asOfDate: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<AccountBalanceRow[]>`
        SELECT coa.account_code, coa.name, coa.account_type, coa.mis_category,
               SUM(gab.debit_total) AS debit_total, SUM(gab.credit_total) AS credit_total
        FROM gl_account_balances gab
        JOIN chart_of_accounts coa ON coa.id = gab.account_id
        JOIN accounting_periods ap ON ap.id = gab.accounting_period_id
        WHERE gab.company_id = ${companyId} AND ap.end_date <= ${asOfDate}::date
          AND coa.account_type IN ('asset', 'liability', 'equity')
        GROUP BY coa.account_code, coa.name, coa.account_type, coa.mis_category
        ORDER BY coa.account_type, coa.account_code
      `;
      // Assets keep the debit-credit convention (a normal debit balance is
      // positive); liabilities and equity are flipped to credit-debit so a
      // normal credit balance also reads as positive — the conventional
      // balance sheet presentation, not the raw ledger sign.
      const accounts = rows.map(mapAccountRow);
      const assets = accounts.filter((a) => a.accountType === 'asset');
      const liabilities = accounts
        .filter((a) => a.accountType === 'liability')
        .map((a) => ({ ...a, balance: -a.balance }));
      const equity = accounts
        .filter((a) => a.accountType === 'equity')
        .map((a) => ({ ...a, balance: -a.balance }));

      const pnl = await this.profitAndLossTotals(tx, companyId, undefined, asOfDate);
      const totalAssets = sumBalance(assets);
      const totalLiabilities = sumBalance(liabilities);
      const totalEquity = sumBalance(equity) + pnl.netProfit;

      return {
        asOfDate,
        assets,
        liabilities,
        equity,
        currentYearEarnings: pnl.netProfit,
        totals: { totalAssets, totalLiabilities, totalEquity },
        balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
      };
    });
  }

  profitAndLoss(tenantId: string, companyId: string, fromDate: string, toDate: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      this.profitAndLossTotals(tx, companyId, fromDate, toDate),
    );
  }

  generalLedger(
    tenantId: string,
    companyId: string,
    accountId: string,
    fromDate: string,
    toDate: string,
  ) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.journalEntryLine.findMany({
        where: {
          accountId,
          journalEntry: {
            companyId,
            status: 'posted',
            entryDate: { gte: new Date(fromDate), lte: new Date(toDate) },
          },
        },
        include: { journalEntry: true },
        orderBy: { journalEntry: { entryDate: 'asc' } },
      }),
    );
  }

  private async profitAndLossTotals(
    tx: Prisma.TransactionClient,
    companyId: string,
    fromDate: string | undefined,
    toDate: string,
  ) {
    const rows = await tx.$queryRaw<AccountBalanceRow[]>`
      SELECT coa.account_code, coa.name, coa.account_type, coa.mis_category,
             SUM(gab.debit_total) AS debit_total, SUM(gab.credit_total) AS credit_total
      FROM gl_account_balances gab
      JOIN chart_of_accounts coa ON coa.id = gab.account_id
      JOIN accounting_periods ap ON ap.id = gab.accounting_period_id
      WHERE gab.company_id = ${companyId}
        AND ap.end_date <= ${toDate}::date
        ${fromDate ? Prisma.sql`AND ap.start_date >= ${fromDate}::date` : Prisma.sql``}
        AND coa.mis_category IN ('REVENUE', 'COGS', 'OPEX')
      GROUP BY coa.account_code, coa.name, coa.account_type, coa.mis_category
      ORDER BY coa.mis_category, coa.account_code
    `;
    const accounts = rows.map(mapAccountRow);
    const revenue = accounts.filter((a) => a.misCategory === 'REVENUE');
    const cogs = accounts.filter((a) => a.misCategory === 'COGS');
    const opex = accounts.filter((a) => a.misCategory === 'OPEX');

    // Income accounts carry a natural credit balance, so "amount" for
    // revenue is credit - debit; expense accounts are debit - credit.
    const totalRevenue = revenue.reduce((s, a) => s + (a.credit - a.debit), 0);
    const totalCogs = cogs.reduce((s, a) => s + (a.debit - a.credit), 0);
    const totalOpex = opex.reduce((s, a) => s + (a.debit - a.credit), 0);
    const grossProfit = totalRevenue - totalCogs;
    const netProfit = grossProfit - totalOpex;

    return {
      fromDate,
      toDate,
      revenue,
      cogs,
      opex,
      totals: { totalRevenue, totalCogs, totalOpex, grossProfit, netProfit },
      netProfit,
    };
  }
}

function mapAccountRow(row: AccountBalanceRow) {
  const debit = Number(row.debit_total);
  const credit = Number(row.credit_total);
  return {
    accountCode: row.account_code,
    name: row.name,
    accountType: row.account_type,
    misCategory: row.mis_category,
    debit,
    credit,
    balance: debit - credit,
  };
}

function sumBalance(rows: ReturnType<typeof mapAccountRow>[]): number {
  return rows.reduce((s, r) => s + r.balance, 0);
}
