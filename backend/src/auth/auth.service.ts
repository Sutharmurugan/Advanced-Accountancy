import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { authenticator } from 'otplib';
import { v4 as uuid } from 'uuid';
import { Prisma } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { OWNER_ROLE_NAME } from '../common/permissions.catalog';
import { LoginDto } from './dto/login.dto';
import { SignupDto } from './dto/signup.dto';
import { TokenPair, TokenService } from './token.service';

const BCRYPT_ROUNDS = 12;
const GENERIC_LOGIN_ERROR = 'Invalid tenant, email, password or MFA code';

@Injectable()
export class AuthService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantPrisma: TenantPrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Bootstraps a brand new tenant: the tenant row itself (via the platform
   * connection — there is no tenant context to SET LOCAL yet, because the
   * tenant doesn't exist until this call), then, scoped to that tenant, a
   * system "Owner" role holding every permission in the catalogue, and the
   * admin user granted that role tenant-wide (UserCompanyAccess.companyId
   * = null), so they can create the tenant's first company next.
   */
  async signup(dto: SignupDto): Promise<TokenPair> {
    const existing = await this.platformPrisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
    });
    if (existing) {
      throw new ConflictException('Tenant slug is already taken');
    }

    const tenantId = uuid();
    await this.platformPrisma.tenant.create({
      data: { id: tenantId, name: dto.tenantName, slug: dto.tenantSlug },
    });

    const passwordHash = await bcrypt.hash(dto.adminPassword, BCRYPT_ROUNDS);

    const userId = await this.tenantPrisma.run(tenantId, async (tx) => {
      const user = await tx.user.create({
        data: { tenantId, email: dto.adminEmail, passwordHash },
      });

      const ownerRole = await tx.role.create({
        data: {
          tenantId,
          companyId: null,
          name: OWNER_ROLE_NAME,
          isSystem: true,
        },
      });

      const allPermissions = await tx.permission.findMany();
      if (allPermissions.length > 0) {
        await tx.rolePermission.createMany({
          data: allPermissions.map((p) => ({
            roleId: ownerRole.id,
            permissionId: p.id,
          })),
        });
      }

      await tx.userCompanyAccess.create({
        data: { userId: user.id, companyId: null, roleId: ownerRole.id },
      });

      await this.audit.record(tx, {
        tenantId,
        userId: user.id,
        action: 'create',
        entityType: 'tenant',
        entityId: tenantId,
        newValue: { name: dto.tenantName, slug: dto.tenantSlug },
      });
      await this.audit.record(tx, {
        tenantId,
        userId: user.id,
        action: 'create',
        entityType: 'user',
        entityId: user.id,
        newValue: { email: dto.adminEmail, role: OWNER_ROLE_NAME },
      });

      return user.id;
    });

    return this.tokens.issueTokenPair(userId, tenantId);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    // Resolving a tenant by slug happens before we have any tenant context —
    // this is the one other legitimate use of the platform (RLS-bypassing)
    // connection. Only non-sensitive routing fields are read.
    const tenant = await this.platformPrisma.tenant.findUnique({
      where: { slug: dto.tenantSlug },
      select: { id: true, status: true },
    });
    if (!tenant || tenant.status !== 'active') {
      throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
    }

    const userId = await this.tenantPrisma.run(tenant.id, async (tx) => {
      const user = await tx.user.findUnique({
        where: { tenantId_email: { tenantId: tenant.id, email: dto.email } },
      });
      if (!user || user.status !== 'active') {
        throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
      }

      const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
      if (!passwordOk) {
        throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
      }

      if (user.mfaEnabled) {
        const codeOk =
          !!dto.totpCode &&
          !!user.mfaSecret &&
          authenticator.verify({ token: dto.totpCode, secret: user.mfaSecret });
        if (!codeOk) {
          throw new UnauthorizedException(GENERIC_LOGIN_ERROR);
        }
      }

      await this.audit.record(tx, {
        tenantId: tenant.id,
        userId: user.id,
        action: 'login',
        entityType: 'user',
        entityId: user.id,
      });

      return user.id;
    });

    return this.tokens.issueTokenPair(userId, tenant.id);
  }

  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const record = await this.tokens.findLiveRefreshToken(rawRefreshToken);
    if (!record) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // The refresh token only tells us the userId; tenantId is looked up via
    // the platform connection because we don't have a tenant context yet at
    // this point in the request (that's exactly what we're re-establishing).
    const user = await this.platformPrisma.user.findUnique({
      where: { id: record.userId },
      select: { id: true, tenantId: true, status: true },
    });
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Rotate: the old refresh token is single-use.
    await this.tokens.revokeRefreshToken(record.id);
    return this.tokens.issueTokenPair(user.id, user.tenantId);
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.tokens.revokeAllForUser(userId);
  }

  async beginMfaEnrollment(
    userId: string,
    tenantId: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const secret = authenticator.generateSecret();
    await this.tenantPrisma.run(tenantId, (tx) =>
      tx.user.update({ where: { id: userId }, data: { mfaSecret: secret } }),
    );
    const user = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.user.findUniqueOrThrow({ where: { id: userId } }),
    );
    const otpauthUrl = authenticator.keyuri(user.email, 'OmniERP', secret);
    return { secret, otpauthUrl };
  }

  async confirmMfaEnrollment(
    userId: string,
    tenantId: string,
    totpCode: string,
  ): Promise<void> {
    await this.tenantPrisma.run(tenantId, async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      const codeOk =
        !!user.mfaSecret &&
        authenticator.verify({ token: totpCode, secret: user.mfaSecret });
      if (!codeOk) {
        throw new UnauthorizedException('Invalid authenticator code');
      }
      await tx.user.update({
        where: { id: userId },
        data: { mfaEnabled: true },
      });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'config_change',
        entityType: 'user',
        entityId: userId,
        newValue: { mfaEnabled: true },
      });
    });
  }
}

// Re-exported so callers importing from auth.service don't also need the
// Prisma namespace just to type a transaction client in tests.
export type TransactionClient = Prisma.TransactionClient;
