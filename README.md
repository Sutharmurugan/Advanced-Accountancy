# OmniERP

A modern, multi-tenant cloud ERP platform — a simpler, affordable alternative to
SAP Business One / NetSuite for SMEs, retail, trading, services businesses and
growing business groups.

OmniERP is designed as a complete **Business Operating System**: multi-tenancy,
central accounting, sales, purchasing, inventory, banking, payroll, MIS,
workflow/approvals and group consolidation — not a standalone bookkeeping app.

## Status

**All 12 roadmap phases implemented.** The full architecture was designed
and approved first (see below), then built phase by phase on a NestJS +
PostgreSQL backend: multi-tenant kernel with Row-Level Security isolation,
JWT + MFA auth and RBAC, master data, the Central Accounting Engine,
Sales/Purchasing, inventory with weighted-average costing, bank
reconciliation, payroll, fixed assets/budgeting, MIS, group consolidation,
and integration adapters. Every phase has a passing automated e2e test
proving its roadmap exit criterion (26 tests across 11 suites) — see
[`backend/README.md`](backend/README.md) for the phase-by-phase breakdown,
including the couple of deliberate, documented simplifications (no GR/IR
clearing account; Phase 12's Peppol/attendance-device adapters are
documented stubs since this environment has no real external
credentials/hardware to connect to).

Start here:

- [`backend/`](backend/) — the full implementation (NestJS + Prisma +
  PostgreSQL). See [`backend/README.md`](backend/README.md) for setup, what
  each phase implements, and how to run the tests.
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

All roadmap phases are implemented and tested. Natural follow-ups from
here (not yet done): a frontend, the documented Phase 6 GR/IR clearing
gap, rate limiting/security-header hardening, and real external
credentials for Phase 12's Peppol/attendance integrations when a business
has them to connect to.
