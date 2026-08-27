import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CreateRoleDto } from './roles.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.role.findMany({
        where: companyId
          ? { OR: [{ companyId: null }, { companyId }] }
          : undefined,
        orderBy: { name: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const role = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.role.findUnique({
        where: { id },
        include: { rolePermissions: { include: { permission: true } } },
      }),
    );
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  create(tenantId: string, userId: string, dto: CreateRoleDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const role = await tx.role.create({
        data: {
          tenantId,
          companyId: dto.companyId ?? null,
          name: dto.name,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'role',
        entityId: role.id,
        newValue: dto,
      });
      return role;
    });
  }

  async addPermission(
    tenantId: string,
    userId: string,
    roleId: string,
    permissionCode: string,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isSystem) {
        throw new BadRequestException(
          'System roles (e.g. Owner) cannot be edited',
        );
      }
      const permission = await tx.permission.findUnique({
        where: { code: permissionCode },
      });
      if (!permission) throw new NotFoundException('Unknown permission code');

      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId, permissionId: permission.id },
        },
        create: { roleId, permissionId: permission.id },
        update: {},
      });

      await this.audit.record(tx, {
        tenantId,
        companyId: role.companyId,
        userId,
        action: 'permission_change',
        entityType: 'role',
        entityId: roleId,
        newValue: { added: permissionCode },
      });
    });
  }

  async removePermission(
    tenantId: string,
    userId: string,
    roleId: string,
    permissionCode: string,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const role = await tx.role.findUnique({ where: { id: roleId } });
      if (!role) throw new NotFoundException('Role not found');
      if (role.isSystem) {
        throw new BadRequestException(
          'System roles (e.g. Owner) cannot be edited',
        );
      }
      const permission = await tx.permission.findUnique({
        where: { code: permissionCode },
      });
      if (!permission) throw new NotFoundException('Unknown permission code');

      await tx.rolePermission.deleteMany({
        where: { roleId, permissionId: permission.id },
      });

      await this.audit.record(tx, {
        tenantId,
        companyId: role.companyId,
        userId,
        action: 'permission_change',
        entityType: 'role',
        entityId: roleId,
        newValue: { removed: permissionCode },
      });
    });
  }
}
