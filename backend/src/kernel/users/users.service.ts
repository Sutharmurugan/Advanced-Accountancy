import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { InviteUserDto, UpdateUserDto } from './users.dto';

const BCRYPT_ROUNDS = 12;

const SAFE_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  status: true,
  mfaEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.user.findMany({ select: SAFE_SELECT, orderBy: { createdAt: 'asc' } }),
    );
  }

  async get(tenantId: string, id: string) {
    const user = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.user.findUnique({ where: { id }, select: SAFE_SELECT }),
    );
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async invite(tenantId: string, invitedBy: string, dto: InviteUserDto) {
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const existing = await tx.user.findUnique({
        where: { tenantId_email: { tenantId, email: dto.email } },
      });
      if (existing) throw new ConflictException('Email already in use');

      const user = await tx.user.create({
        data: { tenantId, email: dto.email, passwordHash },
        select: SAFE_SELECT,
      });
      await this.audit.record(tx, {
        tenantId,
        userId: invitedBy,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        newValue: { email: dto.email },
      });
      return user;
    });
  }

  async update(
    tenantId: string,
    actingUserId: string,
    id: string,
    dto: UpdateUserDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.user.findUnique({ where: { id }, select: SAFE_SELECT });
      if (!before) throw new NotFoundException('User not found');

      const after = await tx.user.update({
        where: { id },
        data: dto,
        select: SAFE_SELECT,
      });
      await this.audit.record(tx, {
        tenantId,
        userId: actingUserId,
        action: 'edit',
        entityType: 'user',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
