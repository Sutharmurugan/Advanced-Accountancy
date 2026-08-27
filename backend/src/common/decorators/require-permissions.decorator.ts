import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Marks a route as requiring one or more permission codes from the
 * `permissions` catalogue (see prisma/seed.ts). PermissionsGuard checks the
 * current user's role grants — tenant-wide (companyId null) or scoped to
 * the company resolved from the request — against this list.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
