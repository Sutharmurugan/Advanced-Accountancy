import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CreateWarehouseDto, UpdateWarehouseDto } from './warehouses.dto';

@Injectable()
export class WarehousesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.warehouse.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const wh = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.warehouse.findUnique({ where: { id } }),
    );
    if (!wh) throw new NotFoundException('Warehouse not found');
    return wh;
  }

  create(tenantId: string, userId: string, dto: CreateWarehouseDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const wh = await tx.warehouse.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: wh.companyId,
        userId,
        action: 'create',
        entityType: 'warehouse',
        entityId: wh.id,
        newValue: dto,
      });
      return wh;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateWarehouseDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.warehouse.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Warehouse not found');
      const after = await tx.warehouse.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'warehouse',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
