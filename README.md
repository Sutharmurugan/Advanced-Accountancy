# OmniERP

A modern, multi-tenant cloud ERP platform — a simpler, affordable alternative to
SAP Business One / NetSuite for SMEs, retail, trading, services businesses and
growing business groups.

OmniERP is designed as a complete **Business Operating System**: multi-tenancy,
central accounting, sales, purchasing, inventory, banking, payroll, MIS,
workflow/approvals and group consolidation — not a standalone bookkeeping app.

## Status

**Design phase.** No application code has been implemented yet. The full
system architecture, database design, central accounting engine design,
security model, MIS/consolidation design and phased roadmap have been produced
for review and approval before Phase 1 implementation begins.

Start here:

- [`docs/architecture/00-OMNIERP-ARCHITECTURE.md`](docs/architecture/00-OMNIERP-ARCHITECTURE.md) —
  the complete architecture document (system design, multi-tenancy, ERD,
  central accounting engine, module map, API design, security/RBAC, MIS,
  consolidation, roadmap, tech stack, risks).
- [`docs/architecture/schema/kernel-and-accounting.sql`](docs/architecture/schema/kernel-and-accounting.sql) —
  illustrative DDL for the kernel and central accounting engine tables
  (reference design, not yet applied as a migration).

## Core principle

> **One posting engine. Every module calls it. Nothing posts to the ledger on its own.**

Sales, Purchasing, Inventory, Banking and Payroll never write journal entries
directly — they all go through the Central Accounting Engine, so there is
exactly one place double-entry accounting logic lives.

## Next step

Awaiting approval on the architecture before Phase 1 (Multi-Tenant Kernel +
Authentication + RBAC) implementation begins.
