import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { TenantPrismaService } from '../prisma/tenant-prisma.service';

/**
 * Enforces RBAC as designed in docs/architecture/00-OMNIERP-ARCHITECTURE.md
 * section G: a role is a bundle of permissions, assigned per company, with
 * an optional tenant-wide grant (UserCompanyAccess.companyId = null) for
 * roles like "Tenant Owner" that aren't scoped to one company.
 *
 * A request is authorized if the current user holds ANY role — tenant-wide,
 * or scoped to the companyId resolved from this request — whose permission
 * set includes one of the codes required by @RequirePermissions(...).
 *
 * This runs as a query inside the same RLS-bound tenant transaction as the
 * rest of the request, so it can never see another tenant's roles even if
 * the JWT were somehow forged with the right shape but wrong tenantId
 * (signature verification prevents that anyway — this is defense in depth).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tenantPrisma: TenantPrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { userId: string; tenantId: string };
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }

    const companyId = resolveCompanyId(request);

    const granted = await this.tenantPrisma.run(user.tenantId, (tx) =>
      tx.userCompanyAccess.findMany({
        where: {
          userId: user.userId,
          OR: [{ companyId: null }, ...(companyId ? [{ companyId }] : [])],
        },
        include: {
          role: {
            include: { rolePermissions: { include: { permission: true } } },
          },
        },
      }),
    );

    const grantedCodes = new Set(
      granted.flatMap((access) =>
        access.role.rolePermissions.map((rp) => rp.permission.code),
      ),
    );

    const authorized = required.some((code) => grantedCodes.has(code));
    if (!authorized) {
      throw new ForbiddenException(
        `Missing required permission: ${required.join(' or ')}`,
      );
    }
    return true;
  }
}

function resolveCompanyId(request: any): string | undefined {
  // params.id is included as a fallback so routes on the Company resource
  // itself (e.g. PATCH /companies/:id) resolve their own id as the company
  // scope. For every other resource this can only ever fail to match (a
  // branch/department id is never equal to a real companyId), never grant
  // something it shouldn't — it's a convenience, not a widened check.
  return (
    request.params?.companyId ||
    request.body?.companyId ||
    request.query?.companyId ||
    request.params?.id ||
    undefined
  );
}
