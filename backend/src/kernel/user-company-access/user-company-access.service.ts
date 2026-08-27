import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { GrantAccessDto } from './user-company-access.dto';

@Injectable()
export class UserCompanyAccessService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, userId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.userCompanyAccess.findMany({
        where: userId ? { userId } : undefined,
        include: { role: true, company: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  grant(tenantId: string, grantedBy: string, dto: GrantAccessDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const access = await tx.userCompanyAccess.create({
        data: {
          userId: dto.userId,
          companyId: dto.companyId ?? null,
          roleId: dto.roleId,
          branchScope: dto.branchScope ?? [],
          departmentScope: dto.departmentScope ?? [],
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId: grantedBy,
        action: 'permission_change',
        entityType: 'user_company_access',
        entityId: access.id,
        newValue: dto,
      });
      return access;
    });
  }

  async revoke(tenantId: string, revokedBy: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const access = await tx.userCompanyAccess.findUnique({ where: { id } });
      if (!access) throw new NotFoundException('Access grant not found');

      await tx.userCompanyAccess.delete({ where: { id } });
      await this.audit.record(tx, {
        tenantId,
        companyId: access.companyId,
        userId: revokedBy,
        action: 'permission_change',
        entityType: 'user_company_access',
        entityId: id,
        oldValue: access,
      });
    });
  }
}
