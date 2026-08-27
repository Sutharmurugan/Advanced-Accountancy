import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { ReportsService } from '../accounting/reports/reports.service';

interface ControlBalanceRow {
  control_type: string;
  debit_total: string;
  credit_total: string;
}

/**
 * MIS is a read-only layer over the same gl_account_balances summary the
 * Accounting Engine maintains (section H) — it never duplicates a ledger
 * row. Revenue/COGS/OPEX come from each account's mis_category tag;
 * cash/AR/AP/inventory come from control_type, both configured once per
 * company at Chart of Accounts setup — so the same formulas work
 * regardless of a company's actual COA numbering.
 */
@Injectable()
export class MisService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly reports: ReportsService,
  ) {}

  async dashboard(tenantId: string, companyId: string, fromDate: string, toDate: string) {
    const pnl = await this.reports.profitAndLoss(tenantId, companyId, fromDate, toDate);
    const controlBalances = await this.controlBalances(tenantId, companyId, toDate);
    const depreciation = await this.accountCodeBalance(tenantId, companyId, '6100', fromDate, toDate);

    const cash = controlBalances.get('BANK') ?? 0;
    const receivables = controlBalances.get('AR') ?? 0;
    const payables = -(controlBalances.get('AP') ?? 0); // shown positive
    const inventory = controlBalances.get('INVENTORY') ?? 0;
    const workingCapital = cash + receivables + inventory - payables;
    const ebitda = pnl.netProfit + depreciation;

    const days = daysBetween(fromDate, toDate);
    const arDays = pnl.totals.totalRevenue > 0 ? (receivables / pnl.totals.totalRevenue) * days : null;
    const apDays = pnl.totals.totalCogs > 0 ? (payables / pnl.totals.totalCogs) * days : null;
    const inventoryDays =
      pnl.totals.totalCogs > 0 ? (inventory / pnl.totals.totalCogs) * days : null;
    const cashConversionCycle =
      arDays !== null && apDays !== null && inventoryDays !== null
        ? arDays + inventoryDays - apDays
        : null;

    return {
      period: { fromDate, toDate },
      revenue: pnl.totals.totalRevenue,
      grossProfit: pnl.totals.grossProfit,
      grossMarginPercent: percent(pnl.totals.grossProfit, pnl.totals.totalRevenue),
      operatingExpenses: pnl.totals.totalOpex,
      ebitda,
      netProfit: pnl.netProfit,
      netMarginPercent: percent(pnl.netProfit, pnl.totals.totalRevenue),
      cash,
      receivables,
      payables,
      inventory,
      workingCapital,
      kpis: {
        arDays,
        apDays,
        inventoryDays,
        cashConversionCycle,
      },
    };
  }

  async periodComparison(
    tenantId: string,
    companyId: string,
    currentFrom: string,
    currentTo: string,
    previousFrom: string,
    previousTo: string,
  ) {
    const current = await this.dashboard(tenantId, companyId, currentFrom, currentTo);
    const previous = await this.dashboard(tenantId, companyId, previousFrom, previousTo);
    return {
      current,
      previous,
      revenueGrowthPercent: percent(current.revenue - previous.revenue, Math.abs(previous.revenue)),
      netProfitVariance: current.netProfit - previous.netProfit,
    };
  }

  /** Drill-down: aggregates gl_account_balances by one dimension at a
   * time, filtered by any dimension already chosen — Group -> Company ->
   * Branch -> Department -> Cost Centre -> Account is just progressively
   * narrower filters on this same query. */
  async drilldown(
    tenantId: string,
    companyId: string,
    fromDate: string,
    toDate: string,
    groupBy: 'branchId' | 'departmentId' | 'costCentreId' | 'profitCentreId' | 'accountId',
    filters: Partial<Record<'branchId' | 'departmentId' | 'costCentreId' | 'profitCentreId', string>>,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const column = toSnakeCase(groupBy);
      const conditions: Prisma.Sql[] = [Prisma.sql`gab.company_id = ${companyId}`];
      conditions.push(Prisma.sql`ap.start_date >= ${fromDate}::date`);
      conditions.push(Prisma.sql`ap.end_date <= ${toDate}::date`);
      for (const [key, value] of Object.entries(filters)) {
        if (value) conditions.push(Prisma.sql`gab.${Prisma.raw(toSnakeCase(key))} = ${value}`);
      }

      const rows = await tx.$queryRaw<
        { group_key: string; debit_total: string; credit_total: string }[]
      >(
        Prisma.sql`
          SELECT gab.${Prisma.raw(column)} AS group_key,
                 SUM(gab.debit_total) AS debit_total, SUM(gab.credit_total) AS credit_total
          FROM gl_account_balances gab
          JOIN accounting_periods ap ON ap.id = gab.accounting_period_id
          WHERE ${Prisma.join(conditions, ' AND ')}
          GROUP BY gab.${Prisma.raw(column)}
          ORDER BY gab.${Prisma.raw(column)}
        `,
      );

      return rows.map((r) => ({
        key: r.group_key || null,
        debit: Number(r.debit_total),
        credit: Number(r.credit_total),
        balance: Number(r.debit_total) - Number(r.credit_total),
      }));
    });
  }

  private async controlBalances(
    tenantId: string,
    companyId: string,
    asOfDate: string,
  ): Promise<Map<string, number>> {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<ControlBalanceRow[]>`
        SELECT coa.control_type, SUM(gab.debit_total) AS debit_total, SUM(gab.credit_total) AS credit_total
        FROM gl_account_balances gab
        JOIN chart_of_accounts coa ON coa.id = gab.account_id
        JOIN accounting_periods ap ON ap.id = gab.accounting_period_id
        WHERE gab.company_id = ${companyId} AND ap.end_date <= ${asOfDate}::date
          AND coa.control_type IS NOT NULL
        GROUP BY coa.control_type
      `;
      const map = new Map<string, number>();
      for (const row of rows) {
        map.set(row.control_type, Number(row.debit_total) - Number(row.credit_total));
      }
      return map;
    });
  }

  private async accountCodeBalance(
    tenantId: string,
    companyId: string,
    accountCode: string,
    fromDate: string,
    toDate: string,
  ): Promise<number> {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ debit_total: string; credit_total: string }[]>`
        SELECT SUM(gab.debit_total) AS debit_total, SUM(gab.credit_total) AS credit_total
        FROM gl_account_balances gab
        JOIN chart_of_accounts coa ON coa.id = gab.account_id
        JOIN accounting_periods ap ON ap.id = gab.accounting_period_id
        WHERE gab.company_id = ${companyId} AND coa.account_code = ${accountCode}
          AND ap.start_date >= ${fromDate}::date AND ap.end_date <= ${toDate}::date
      `;
      if (!rows[0] || rows[0].debit_total === null) return 0;
      return Number(rows[0].debit_total) - Number(rows[0].credit_total);
    });
  }
}

function percent(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

function daysBetween(fromDate: string, toDate: string): number {
  const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
  return Math.max(1, Math.round(ms / 86_400_000) + 1);
}

function toSnakeCase(camel: string): string {
  return camel.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}
