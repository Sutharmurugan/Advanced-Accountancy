import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CompanyProvisioningService } from '../company-provisioning.service';

@Injectable()
export class FiscalPeriodsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly provisioning: CompanyProvisioningService,
  ) {}

  listFiscalYears(tenantId: string, companyId: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.fiscalYear.findMany({
        where: { companyId },
        include: { periods: { orderBy: { periodNo: 'asc' } } },
        orderBy: { startDate: 'asc' },
      }),
    );
  }

  /** Provisions the next calendar year's 12 monthly periods for a company. */
  createNextFiscalYear(tenantId: string, userId: string, companyId: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const latest = await tx.fiscalYear.findFirst({
        where: { companyId },
        orderBy: { startDate: 'desc' },
      });
      const nextYear = latest
        ? latest.startDate.getUTCFullYear() + 1
        : new Date().getUTCFullYear();

      const fiscalYear = await tx.fiscalYear.create({
        data: {
          tenantId,
          companyId,
          name: `FY${nextYear}`,
          startDate: new Date(Date.UTC(nextYear, 0, 1)),
          endDate: new Date(Date.UTC(nextYear, 11, 31)),
        },
      });
      for (let month = 0; month < 12; month++) {
        await tx.accountingPeriod.create({
          data: {
            tenantId,
            fiscalYearId: fiscalYear.id,
            periodNo: month + 1,
            startDate: new Date(Date.UTC(nextYear, month, 1)),
            endDate: new Date(Date.UTC(nextYear, month + 1, 0)),
          },
        });
      }
      await this.audit.record(tx, {
        tenantId,
        companyId,
        userId,
        action: 'create',
        entityType: 'fiscal_year',
        entityId: fiscalYear.id,
        newValue: { name: fiscalYear.name },
      });
      return tx.fiscalYear.findUnique({
        where: { id: fiscalYear.id },
        include: { periods: { orderBy: { periodNo: 'asc' } } },
      });
    });
  }

  async setPeriodStatus(
    tenantId: string,
    userId: string,
    periodId: string,
    status: 'open' | 'closed' | 'locked',
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.accountingPeriod.findUnique({ where: { id: periodId } });
      if (!before) throw new NotFoundException('Accounting period not found');

      const after = await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status },
      });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: status === 'open' ? 'config_change' : 'post',
        entityType: 'accounting_period',
        entityId: periodId,
        oldValue: { status: before.status },
        newValue: { status: after.status },
      });
      return after;
    });
  }
}
