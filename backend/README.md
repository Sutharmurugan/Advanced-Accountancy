# OmniERP Backend — Phase 1

Multi-Tenant Kernel + Authentication + RBAC, per
[`docs/architecture/00-OMNIERP-ARCHITECTURE.md`](../docs/architecture/00-OMNIERP-ARCHITECTURE.md)
section J. NestJS + Prisma + PostgreSQL.

## What's implemented

- **Tenant hierarchy**: Tenant → Business Group → Company → Branch /
  Department / Cost Centre / Profit Centre / Warehouse.
- **Row-Level Security**: every tenant-scoped table is protected by a
  Postgres RLS policy, enforced through a dedicated low-privilege
  `omnierp_app` database role (not the migration/owner role — owners and
  superusers bypass RLS). See `prisma/migrations/*_rls_and_guards/`.
- **Auth**: signup (bootstraps a tenant + Owner user), login, JWT
  access/refresh tokens with rotation and revocation, TOTP-based MFA
  enrollment.
- **RBAC**: roles are bundles of permissions from a global catalogue
  (`src/common/permissions.catalog.ts`), grantable tenant-wide or scoped to
  one company (`user_company_access`).
- **Audit log**: append-only, hash-chained `audit_logs` table — the
  application's database role has no `UPDATE`/`DELETE` grant on it at all,
  and a trigger rejects both regardless.

## Two Prisma connections, on purpose

- `PlatformPrismaService` connects with the migration/owner credentials
  (superuser — bypasses RLS). Used for exactly two things: creating a brand
  new tenant at signup, and resolving a tenant by slug during login. Nothing
  else should use it.
- `TenantPrismaService` connects as `omnierp_app` (RLS-bound). All
  tenant-scoped work goes through `tenantPrisma.run(tenantId, tx => ...)`,
  which opens one transaction, sets `app.tenant_id` for that transaction
  only via `set_config(...)`, and only then runs the query.

## Setup

```bash
npm install
cp .env.example .env               # point at your local Postgres

# create the app role + RLS policies + kernel tables
npx prisma migrate deploy

# seed the permission catalogue
npx prisma db seed

npm run start:dev
```

The API is served under `/api/v1`.

## Running the tests

The exit criterion for Phase 1 (roadmap section J) is a passing automated
cross-tenant isolation test. It runs against a real Postgres database
(`omnierp_test` by default — see `.env.test`), at three layers: the HTTP
API, a direct service call that bypasses the controller entirely, and a
raw query with no tenant context set at all (fail-closed check), plus the
audit log's append-only guarantee and a basic RBAC-denial check.

```bash
createdb omnierp_test   # once
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/omnierp_test?schema=public" \
  npx prisma migrate deploy

npm test
```

## Try it by hand

```bash
BASE=http://localhost:3000/api/v1

curl -s -X POST $BASE/auth/signup -H 'Content-Type: application/json' -d '{
  "tenantName": "Acme Group", "tenantSlug": "acme",
  "adminEmail": "owner@acme.test", "adminPassword": "supersecret123"
}'
# -> { accessToken, refreshToken, expiresIn }

curl -s -X POST $BASE/companies -H "Authorization: Bearer <accessToken>" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Acme Singapore Pte Ltd","countryCode":"SG","baseCurrencyCode":"SGD"}'
```

## Known Phase 1 scope limits (by design, not oversight)

- No rate limiting / security headers middleware yet — flagged for the
  hardening pass alongside Phase 2, not required for the Phase 1 exit
  criterion.
- `PermissionsGuard` resolves the company a request is scoped to from
  `params.companyId` / `body.companyId` / `query.companyId` (or `params.id`
  for the Company resource itself). For sub-resources addressed only by
  their own id (e.g. `PATCH /branches/:id`), a company-scoped (non-tenant-wide)
  grant won't be picked up yet — only a tenant-wide role will authorize
  those routes. The Owner role created at signup is tenant-wide, so this
  doesn't block Phase 1; resolving a resource's companyId by looking it up
  inside the guard is a follow-up for when non-owner, company-scoped roles
  matter more (Phase 2+).
- No hard-delete endpoints for branches/departments/cost centres/profit
  centres/warehouses — these entities have no status column to deactivate
  yet; only create/list/get/update exist.
