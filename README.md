# OmniERP

A modern, multi-tenant cloud ERP platform — a simpler, affordable alternative to
SAP Business One / NetSuite for SMEs, retail, trading, services businesses and
growing business groups.

OmniERP is designed as a complete **Business Operating System**: multi-tenancy,
central accounting, sales, purchasing, inventory, banking, payroll, MIS,
workflow/approvals and group consolidation — not a standalone bookkeeping app.

## Status

**Phase 1 implemented: Multi-Tenant Kernel + Authentication + RBAC.** The
full architecture was designed and approved first (see below); Phase 1 now
has a working NestJS + PostgreSQL backend with Row-Level Security tenant
isolation, JWT + MFA auth, and RBAC — with an automated test suite proving
the phase's exit criterion (cross-tenant isolation) at the API layer, the
service layer, and the raw database layer.

Start here:

- [`backend/`](backend/) — the Phase 1 implementation (NestJS + Prisma +
  PostgreSQL). See [`backend/README.md`](backend/README.md) for setup and
  how to run the tests.
- [`docs/architecture/00-OMNIERP-ARCHITECTURE.md`](docs/architecture/00-OMNIERP-ARCHITECTURE.md) —
  the complete architecture document (system design, multi-tenancy, ERD,
  central accounting engine, module map, API design, security/RBAC, MIS,
  consolidation, roadmap, tech stack, risks).
- [`docs/architecture/schema/kernel-and-accounting.sql`](docs/architecture/schema/kernel-and-accounting.sql) —
  illustrative DDL for the kernel and central accounting engine tables
  (reference design; the actual applied migrations are in
  `backend/prisma/migrations/`).

## Core principle

> **One posting engine. Every module calls it. Nothing posts to the ledger on its own.**

Sales, Purchasing, Inventory, Banking and Payroll never write journal entries
directly — they all go through the Central Accounting Engine, so there is
exactly one place double-entry accounting logic lives.

## Next step

Phase 2: Database + Master Data (Chart of Accounts, tax codes, customers,
suppliers, employees, products, price lists, projects).
