import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import {
  CreateBusinessGroupDto,
  UpdateBusinessGroupDto,
} from './business-groups.dto';

@Injectable()
export class BusinessGroupsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.businessGroup.findMany({ orderBy: { createdAt: 'asc' } }),
    );
  }

  async get(tenantId: string, id: string) {
    const group = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.businessGroup.findUnique({ where: { id } }),
    );
    if (!group) throw new NotFoundException('Business group not found');
    return group;
  }

  create(tenantId: string, userId: string, dto: CreateBusinessGroupDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const group = await tx.businessGroup.create({
        data: { tenantId, name: dto.name },
      });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'create',
        entityType: 'business_group',
        entityId: group.id,
        newValue: dto,
      });
      return group;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateBusinessGroupDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.businessGroup.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Business group not found');
      const after = await tx.businessGroup.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'edit',
        entityType: 'business_group',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
