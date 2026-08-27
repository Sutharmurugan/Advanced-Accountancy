import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CreateCostCentreDto, UpdateCostCentreDto } from './cost-centres.dto';

@Injectable()
export class CostCentresService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.costCentre.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const cc = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.costCentre.findUnique({ where: { id } }),
    );
    if (!cc) throw new NotFoundException('Cost centre not found');
    return cc;
  }

  create(tenantId: string, userId: string, dto: CreateCostCentreDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const cc = await tx.costCentre.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: cc.companyId,
        userId,
        action: 'create',
        entityType: 'cost_centre',
        entityId: cc.id,
        newValue: dto,
      });
      return cc;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateCostCentreDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.costCentre.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Cost centre not found');
      const after = await tx.costCentre.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'cost_centre',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
