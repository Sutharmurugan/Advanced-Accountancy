import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import {
  CreateProfitCentreDto,
  UpdateProfitCentreDto,
} from './profit-centres.dto';

@Injectable()
export class ProfitCentresService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.profitCentre.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const pc = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.profitCentre.findUnique({ where: { id } }),
    );
    if (!pc) throw new NotFoundException('Profit centre not found');
    return pc;
  }

  create(tenantId: string, userId: string, dto: CreateProfitCentreDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const pc = await tx.profitCentre.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: pc.companyId,
        userId,
        action: 'create',
        entityType: 'profit_centre',
        entityId: pc.id,
        newValue: dto,
      });
      return pc;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateProfitCentreDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.profitCentre.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Profit centre not found');
      const after = await tx.profitCentre.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'profit_centre',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
