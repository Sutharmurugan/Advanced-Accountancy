/**
 * The global permission catalogue (see docs/architecture, section G:
 * "permission = module.action"). This is the single source of truth for
 * both the Prisma seed (which upserts these into the `permissions` table)
 * and the @RequirePermissions(...) decorators used across the kernel
 * modules — so a typo in either place fails fast rather than silently
 * granting nothing.
 */
export const PERMISSIONS = [
  { code: 'company.create', module: 'kernel', description: 'Create a legal company' },
  { code: 'company.read', module: 'kernel', description: 'View company records' },
  { code: 'company.update', module: 'kernel', description: 'Edit company records' },
  { code: 'company.delete', module: 'kernel', description: 'Deactivate/delete a company' },

  { code: 'business_group.manage', module: 'kernel', description: 'Manage business groups' },

  { code: 'branch.manage', module: 'kernel', description: 'Manage branches' },
  { code: 'department.manage', module: 'kernel', description: 'Manage departments' },
  { code: 'cost_centre.manage', module: 'kernel', description: 'Manage cost centres' },
  { code: 'profit_centre.manage', module: 'kernel', description: 'Manage profit centres' },
  { code: 'warehouse.manage', module: 'kernel', description: 'Manage warehouses' },

  { code: 'user.invite', module: 'kernel', description: 'Invite/create users in the tenant' },
  { code: 'user.read', module: 'kernel', description: 'View users' },
  { code: 'user.update', module: 'kernel', description: 'Edit or disable users' },

  { code: 'role.manage', module: 'kernel', description: 'Create/edit roles and permission grants' },
  { code: 'user_company_access.grant', module: 'kernel', description: 'Grant or revoke a user\'s company/role access' },

  { code: 'audit_log.read', module: 'kernel', description: 'View the audit trail' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

/** Every permission code, granted in full to the automatically created
 * tenant-wide "Owner" role at signup. */
export const OWNER_ROLE_NAME = 'Owner';
