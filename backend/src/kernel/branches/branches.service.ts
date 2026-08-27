import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CreateBranchDto, UpdateBranchDto } from './branches.dto';

@Injectable()
export class BranchesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.branch.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const branch = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.branch.findUnique({ where: { id } }),
    );
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  create(tenantId: string, userId: string, dto: CreateBranchDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const branch = await tx.branch.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: branch.companyId,
        userId,
        action: 'create',
        entityType: 'branch',
        entityId: branch.id,
        newValue: dto,
      });
      return branch;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateBranchDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.branch.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Branch not found');
      const after = await tx.branch.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'branch',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
