import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './departments.dto';

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.department.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const dept = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.department.findUnique({ where: { id } }),
    );
    if (!dept) throw new NotFoundException('Department not found');
    return dept;
  }

  create(tenantId: string, userId: string, dto: CreateDepartmentDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const dept = await tx.department.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: dept.companyId,
        userId,
        action: 'create',
        entityType: 'department',
        entityId: dept.id,
        newValue: dto,
      });
      return dept;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateDepartmentDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.department.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Department not found');
      const after = await tx.department.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'department',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
