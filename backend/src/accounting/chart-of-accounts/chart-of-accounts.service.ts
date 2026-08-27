import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import {
  CreateChartOfAccountDto,
  UpdateChartOfAccountDto,
} from './chart-of-accounts.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.chartOfAccount.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { accountCode: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const account = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.chartOfAccount.findUnique({ where: { id } }),
    );
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  create(tenantId: string, userId: string, dto: CreateChartOfAccountDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const account = await tx.chartOfAccount.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: account.companyId,
        userId,
        action: 'create',
        entityType: 'chart_of_account',
        entityId: account.id,
        newValue: dto,
      });
      return account;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateChartOfAccountDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.chartOfAccount.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Account not found');
      const after = await tx.chartOfAccount.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'chart_of_account',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
