import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  STARTER_CHART_OF_ACCOUNTS,
  STARTER_POSTING_RULES,
} from './company-provisioning.data';

/**
 * Runs once, in the same transaction as company creation, so a new company
 * is immediately postable: a starter Chart of Accounts (tagged with the
 * control types the Accounting Engine's default posting rules resolve
 * against), the posting rules themselves, and the current fiscal year split
 * into 12 monthly periods.
 *
 * This is provisioning data, not per-tenant business logic — every company
 * gets the same starter set, and any of it can be edited afterwards through
 * the normal Chart of Accounts / Posting Rules APIs.
 */
@Injectable()
export class CompanyProvisioningService {
  async provision(
    tx: Prisma.TransactionClient,
    tenantId: string,
    companyId: string,
    baseCurrencyCode: string,
  ): Promise<void> {
    const accountIdByCode = new Map<string, string>();
    for (const acc of STARTER_CHART_OF_ACCOUNTS) {
      const created = await tx.chartOfAccount.create({
        data: {
          tenantId,
          companyId,
          accountCode: acc.accountCode,
          name: acc.name,
          accountType: acc.accountType,
          controlType: acc.controlType,
          misCategory: acc.misCategory,
          currencyCode: baseCurrencyCode,
        },
      });
      accountIdByCode.set(acc.accountCode, created.id);
    }

    for (const rule of STARTER_POSTING_RULES) {
      const created = await tx.postingRule.create({
        data: { tenantId, companyId, eventType: rule.eventType },
      });
      await tx.postingRuleLine.createMany({
        data: rule.lines.map((line) => ({
          postingRuleId: created.id,
          lineNo: line.lineNo,
          side: line.side,
          accountResolver: line.accountResolver,
          amountSource: line.amountSource,
        })),
      });
    }

    await this.provisionCurrentFiscalYear(tx, tenantId, companyId);
  }

  async provisionCurrentFiscalYear(
    tx: Prisma.TransactionClient,
    tenantId: string,
    companyId: string,
  ): Promise<void> {
    const now = new Date();
    const startDate = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const endDate = new Date(Date.UTC(now.getUTCFullYear(), 11, 31));

    const fiscalYear = await tx.fiscalYear.create({
      data: {
        tenantId,
        companyId,
        name: `FY${now.getUTCFullYear()}`,
        startDate,
        endDate,
      },
    });

    for (let month = 0; month < 12; month++) {
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), month, 1));
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), month + 1, 0));
      await tx.accountingPeriod.create({
        data: {
          tenantId,
          fiscalYearId: fiscalYear.id,
          periodNo: month + 1,
          startDate: periodStart,
          endDate: periodEnd,
        },
      });
    }
  }
}
