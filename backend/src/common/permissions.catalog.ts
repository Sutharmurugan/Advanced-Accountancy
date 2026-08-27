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

  // Phase 2 — master data
  { code: 'masterdata.manage', module: 'masterdata', description: 'Manage Chart of Accounts, tax, customers, suppliers, employees, products and other master data' },
  { code: 'masterdata.read', module: 'masterdata', description: 'View master data' },

  // Phase 3/4 — accounting engine & finance
  { code: 'journal_entry.create', module: 'accounting', description: 'Create/edit draft journal entries' },
  { code: 'journal_entry.approve', module: 'accounting', description: 'Approve and post journal entries' },
  { code: 'journal_entry.reverse', module: 'accounting', description: 'Reverse a posted journal entry' },
  { code: 'journal_entry.read', module: 'accounting', description: 'View journal entries' },
  { code: 'fiscal_period.manage', module: 'accounting', description: 'Create fiscal years/periods and close periods' },
  { code: 'report.read', module: 'accounting', description: 'View financial and MIS reports' },
  { code: 'posting_rule.manage', module: 'accounting', description: 'Configure posting rules' },

  // Phase 5 — sales & purchasing
  { code: 'sales.manage', module: 'sales', description: 'Manage quotations, sales orders, deliveries, invoices and receipts' },
  { code: 'sales.read', module: 'sales', description: 'View sales documents' },
  { code: 'purchasing.manage', module: 'purchasing', description: 'Manage purchase requests, orders, goods receipts, supplier invoices and payments' },
  { code: 'purchasing.read', module: 'purchasing', description: 'View purchasing documents' },

  // Phase 6 — inventory
  { code: 'inventory.manage', module: 'inventory', description: 'Manage warehouse transfers, adjustments and stock counts' },
  { code: 'inventory.read', module: 'inventory', description: 'View stock balances and movement history' },

  // Phase 7 — banking
  { code: 'banking.manage', module: 'banking', description: 'Import bank statements and approve/post reconciliation matches' },
  { code: 'banking.read', module: 'banking', description: 'View bank statements and reconciliation status' },

  // Phase 8 — HR & payroll
  { code: 'payroll.manage', module: 'payroll', description: 'Manage salary structures and payroll runs' },
  { code: 'payroll.read', module: 'payroll', description: 'View payroll runs and payslips' },

  // Phase 9 — assets & budgeting
  { code: 'assets.manage', module: 'assets', description: 'Manage fixed assets and post depreciation' },
  { code: 'budget.manage', module: 'budgeting', description: 'Create and edit budgets' },

  // Phase 11 — consolidation
  { code: 'consolidation.manage', module: 'consolidation', description: 'Run and finalize group consolidation' },
  { code: 'consolidation.read', module: 'consolidation', description: 'View consolidated statements' },

  // Phase 12 — integrations
  { code: 'integration.manage', module: 'integrations', description: 'Configure external integration adapters' },
] as const;

export type PermissionCode = (typeof PERMISSIONS)[number]['code'];

/** Every permission code, granted in full to the automatically created
 * tenant-wide "Owner" role at signup. */
export const OWNER_ROLE_NAME = 'Owner';
