# OmniERP Backend

NestJS + Prisma + PostgreSQL implementation, tracking the phased roadmap in
[`docs/architecture/00-OMNIERP-ARCHITECTURE.md`](../docs/architecture/00-OMNIERP-ARCHITECTURE.md)
section J. This file is updated as each phase lands — see git history for
the sequence.

## What's implemented (Phases 1–6)

- **Phase 1 — Kernel, auth, RBAC**: Tenant → Business Group → Company →
  Branch / Department / Cost Centre / Profit Centre / Warehouse. Every
  tenant-scoped table is protected by Postgres Row-Level Security through a
  dedicated low-privilege `omnierp_app` role (see `prisma/migrations/*_rls_and_guards/`).
  Signup/login with JWT access+refresh tokens and TOTP MFA. RBAC via a
  global permission catalogue (`src/common/permissions.catalog.ts`) and
  tenant-wide or company-scoped role grants. Append-only, hash-chained
  `audit_logs` (INSERT-only grant, trigger-enforced).
- **Phase 2 — Master data**: Chart of Accounts, tax codes/rates, payment
  terms, bank accounts, customers, suppliers, employees, products
  (+categories/brands/UOM), price lists, salespersons, projects, currencies.
- **Phase 3/4 — Central Accounting Engine & Finance**: `AccountingEngineService`
  (`src/accounting/accounting-engine.service.ts`) is the only writer of
  posted journal entries — every module calls `postEvent()` with business
  amounts, and a company's data-driven `PostingRule` rows decide which
  accounts get hit. Company creation auto-provisions a starter Chart of
  Accounts + posting rules + fiscal year (`CompanyProvisioningService`), so
  a new company is immediately postable. Manual journal entry workflow
  (draft → submitted → approved → posted → reversed), period open/close,
  and Trial Balance / Balance Sheet / P&L / General Ledger reports computed
  from the incrementally maintained `gl_account_balances` summary.
- **Phase 5 — Sales & Purchasing**: Quotation → Sales Order → Delivery →
  Sales Invoice → Customer Receipt, and Purchase Request → Purchase Order →
  Goods Receipt → Supplier Invoice → Supplier Payment, plus Credit/Debit
  notes. Only Invoices, Receipts/Payments and Credit/Debit Notes touch the
  ledger.
- **Phase 6 — Inventory**: `InventoryService` is the unified stock ledger —
  `stock_moves` (append-only movements) and `stock_balances` (incremental
  weighted-average valuation), same pattern as `gl_account_balances`.
  Goods Receipt blends cost into the running average; Delivery draws stock
  out at the current average and automatically posts a COGS entry through
  the Accounting Engine; Stock Counts post their variance the same way.

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

## Known scope limits (by design, not oversight)

- No rate limiting / security headers middleware yet — a hardening pass
  that hasn't been prioritized over roadmap breadth.
- `PermissionsGuard` resolves the company a request is scoped to from
  `params.companyId` / `body.companyId` / `query.companyId` (or `params.id`
  for the Company resource itself). For sub-resources addressed only by
  their own id (e.g. `PATCH /branches/:id`), a company-scoped (non-tenant-wide)
  grant won't be picked up yet — only a tenant-wide role will authorize
  those routes. The Owner role created at signup is tenant-wide, so this
  doesn't block any current exit criterion; resolving a resource's
  companyId by looking it up inside the guard is a follow-up for when
  non-owner, company-scoped roles matter more.
- No hard-delete endpoints for branches/departments/cost centres/profit
  centres/warehouses — these entities have no status column to deactivate
  yet; only create/list/get/update exist.
- **No GR/IR clearing account** (Phase 6): Goods Receipt updates
  `stock_balances` (quantity + weighted-average cost) but posts no GL entry
  of its own; Supplier Invoice still posts to a generic expense/AP entry
  from Phase 5. This means the Inventory GL control account is *not*
  automatically reconciled from purchases — only Delivery (COGS) and Stock
  Count adjustments move it. A correct fix needs either line-level,
  product-aware posting rules (debit Inventory vs. Expense per line
  depending on `product.isInventoryTracked`) or a proper GR/IR clearing
  account bridging receipt and invoice timing — deferred as a follow-up.
- No batch/serial number tracking yet, though the schema has columns for
  it (`stock_moves.batchNumber`/`serialNumber`) — only aggregate quantity
  and weighted-average cost per warehouse+product.
