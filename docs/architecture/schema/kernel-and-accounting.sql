-- ============================================================================
-- OmniERP — Illustrative kernel + central accounting engine schema
--
-- STATUS: Design reference only. This is NOT an applied migration — it exists
-- to make the entity/relationship design in
-- docs/architecture/00-OMNIERP-ARCHITECTURE.md concrete and reviewable before
-- Phase 1 implementation begins. Column lists are representative, not final;
-- exact types/constraints will be finalized as real migrations in Phase 1/3.
--
-- Conventions used throughout:
--   * every tenant-scoped table carries tenant_id and is protected by RLS
--   * money columns are NUMERIC, never FLOAT
--   * every table has created_at/updated_at, plus created_by/updated_by
--     (FK to users) on anything a human can create/edit
--   * ids are UUID (gen_random_uuid()) so they're safe to expose in APIs
--     without leaking row counts/order
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- KERNEL: platform / tenant / org hierarchy
-- ----------------------------------------------------------------------------

create table tenants (
    id              uuid primary key default gen_random_uuid(),
    name            text not null,
    slug            text not null unique,          -- subdomain / routing key
    plan            text not null default 'standard',
    status          text not null default 'active' check (status in ('active','suspended','cancelled')),
    storage_tier    text not null default 'pool' check (storage_tier in ('pool','silo')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table business_groups (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    name        text not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table companies (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id),
    business_group_id   uuid references business_groups(id),   -- nullable: a tenant may have one standalone company
    name                text not null,
    legal_name          text,
    country_code        text not null,                          -- drives which localization/tax pack applies
    base_currency_code  text not null,
    fiscal_year_start_month smallint not null default 1,
    tax_registration_no text,
    status              text not null default 'active' check (status in ('active','inactive')),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create table branches (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    company_id  uuid not null references companies(id),
    name        text not null,
    address     text,
    is_default  boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table departments (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    company_id  uuid not null references companies(id),
    branch_id   uuid references branches(id),
    name        text not null,
    created_at  timestamptz not null default now()
);

create table cost_centres (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    company_id  uuid not null references companies(id),
    parent_id   uuid references cost_centres(id),   -- hierarchy
    code        text not null,
    name        text not null,
    created_at  timestamptz not null default now()
);

create table profit_centres (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    company_id  uuid not null references companies(id),
    code        text not null,
    name        text not null,
    created_at  timestamptz not null default now()
);

create table warehouses (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    company_id  uuid not null references companies(id),
    branch_id   uuid references branches(id),
    name        text not null,
    address     text,
    created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- KERNEL: identity, RBAC, access grants
-- ----------------------------------------------------------------------------

create table users (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    email           citext not null,
    password_hash   text not null,
    mfa_enabled     boolean not null default false,
    mfa_secret      text,
    status          text not null default 'active' check (status in ('active','disabled')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    unique (tenant_id, email)
);

create table roles (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    company_id  uuid references companies(id),   -- null = tenant-level template role
    name        text not null,
    is_system   boolean not null default false,
    created_at  timestamptz not null default now()
);

create table permissions (
    id          uuid primary key default gen_random_uuid(),
    code        text not null unique,       -- e.g. 'sales_invoice.approve', 'journal_entry.reverse'
    module      text not null,
    description text
);

create table role_permissions (
    role_id       uuid not null references roles(id),
    permission_id uuid not null references permissions(id),
    primary key (role_id, permission_id)
);

create table user_company_access (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references users(id),
    company_id      uuid not null references companies(id),
    role_id         uuid not null references roles(id),
    branch_scope    uuid[] ,     -- null = all branches; else restrict to listed branch ids
    department_scope uuid[],
    created_at      timestamptz not null default now(),
    unique (user_id, company_id, role_id)
);

-- ----------------------------------------------------------------------------
-- KERNEL: fiscal calendar, currency
-- ----------------------------------------------------------------------------

create table fiscal_years (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references companies(id),
    name        text not null,             -- e.g. 'FY2026'
    start_date  date not null,
    end_date    date not null,
    status      text not null default 'open' check (status in ('open','closed'))
);

create table accounting_periods (
    id              uuid primary key default gen_random_uuid(),
    fiscal_year_id  uuid not null references fiscal_years(id),
    period_no       smallint not null,
    start_date      date not null,
    end_date        date not null,
    status          text not null default 'open' check (status in ('open','closed','locked')),
    unique (fiscal_year_id, period_no)
);

create table currencies (
    code    text primary key,   -- ISO 4217, e.g. 'SGD'
    name    text not null,
    symbol  text
);

create table exchange_rates (
    id              uuid primary key default gen_random_uuid(),
    company_id      uuid not null references companies(id),
    from_currency   text not null references currencies(code),
    to_currency     text not null references currencies(code),
    rate            numeric(18,8) not null,
    rate_date       date not null,
    rate_type       text not null default 'spot' check (rate_type in ('spot','period_average','period_closing','historical')),
    created_at      timestamptz not null default now(),
    unique (company_id, from_currency, to_currency, rate_date, rate_type)
);

-- ----------------------------------------------------------------------------
-- KERNEL: numbering, workflow, audit, attachments, notifications
-- ----------------------------------------------------------------------------

create table document_number_sequences (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references companies(id),
    branch_id   uuid references branches(id),
    doc_type    text not null,        -- 'SALES_INVOICE', 'JOURNAL_ENTRY', ...
    prefix      text not null default '',
    next_number bigint not null default 1,
    format      text not null default '{prefix}{number:06d}',
    unique (company_id, branch_id, doc_type)
);

create table approval_workflows (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references companies(id),
    doc_type    text not null,
    rules       jsonb not null,   -- thresholds by amount/branch/dept/role -> ordered approval steps
    is_active   boolean not null default true
);

create table approval_requests (
    id              uuid primary key default gen_random_uuid(),
    workflow_id     uuid not null references approval_workflows(id),
    doc_type        text not null,
    doc_id          uuid not null,
    status          text not null default 'pending' check (status in ('pending','approved','rejected')),
    current_step    smallint not null default 1,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table audit_logs (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    company_id      uuid references companies(id),
    user_id         uuid references users(id),
    action          text not null,   -- create/edit/approve/post/cancel/reverse/delete/export/login/permission_change/config_change
    entity_type     text not null,
    entity_id       uuid,
    old_value       jsonb,
    new_value       jsonb,
    prev_row_hash   text,            -- hash-chained for tamper evidence
    row_hash        text,
    ip_address      inet,
    created_at      timestamptz not null default now()
);
-- audit_logs is append-only: the application DB role is granted INSERT only,
-- never UPDATE/DELETE, on this table.

create table attachments (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    company_id  uuid references companies(id),
    entity_type text not null,
    entity_id   uuid not null,
    file_url    text not null,
    uploaded_by uuid references users(id),
    created_at  timestamptz not null default now()
);

create table notifications (
    id          uuid primary key default gen_random_uuid(),
    tenant_id   uuid not null references tenants(id),
    user_id     uuid not null references users(id),
    type        text not null,
    payload     jsonb not null default '{}',
    read_at     timestamptz,
    created_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- MASTER DATA (subset — Chart of Accounts shown in full since the accounting
-- engine depends directly on it; others summarized)
-- ----------------------------------------------------------------------------

create table chart_of_accounts (
    id              uuid primary key default gen_random_uuid(),
    tenant_id       uuid not null references tenants(id),
    company_id      uuid not null references companies(id),
    parent_id       uuid references chart_of_accounts(id),
    account_code    text not null,
    name            text not null,
    account_type    text not null check (account_type in ('asset','liability','equity','income','expense')),
    control_type    text check (control_type in ('AR','AP','BANK','INVENTORY','TAX_OUTPUT','TAX_INPUT', null)),
    mis_category    text,     -- semantic tag used by MIS: 'REVENUE','COGS','OPEX', etc. (see doc section H)
    currency_code   text references currencies(code),
    is_active       boolean not null default true,
    unique (company_id, account_code)
);

-- customers, suppliers, employees, products, uoms, price_lists, projects, etc.
-- follow the same tenant_id/company_id-scoped pattern; omitted here for
-- brevity — see the ER diagrams in 00-OMNIERP-ARCHITECTURE.md section C.

-- ----------------------------------------------------------------------------
-- CENTRAL ACCOUNTING ENGINE — the core of the whole platform
-- ----------------------------------------------------------------------------

create table posting_rules (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references companies(id),
    event_type  text not null,     -- 'SALES_INVOICE_POSTED', 'SUPPLIER_PAYMENT_POSTED', ...
    is_active   boolean not null default true,
    unique (company_id, event_type)
);

create table posting_rule_lines (
    id                  uuid primary key default gen_random_uuid(),
    posting_rule_id     uuid not null references posting_rules(id),
    line_no             smallint not null,
    side                text not null check (side in ('debit','credit')),
    account_resolver    text not null,   -- e.g. 'CONTROL:AR', 'CONTROL:TAX_OUTPUT', 'ITEM_CATEGORY_REVENUE_ACCOUNT'
    amount_source       text not null,   -- e.g. 'invoice.subtotal', 'invoice.tax_amount'
    unique (posting_rule_id, line_no)
);

create table journal_entries (
    id                  uuid primary key default gen_random_uuid(),
    tenant_id           uuid not null references tenants(id),
    company_id          uuid not null references companies(id),
    branch_id           uuid references branches(id),
    accounting_period_id uuid not null references accounting_periods(id),
    posting_rule_id     uuid references posting_rules(id),
    source_module       text not null,      -- 'SALES','PURCHASING','PAYROLL','MANUAL',...
    source_doc_type     text,
    source_doc_id       uuid,
    entry_date          date not null,
    currency_code       text not null references currencies(code),
    exchange_rate       numeric(18,8) not null default 1,
    status              text not null default 'draft'
                         check (status in ('draft','submitted','approved','posted','cancelled','reversed')),
    reversal_of_id      uuid references journal_entries(id),
    description         text,
    created_by          uuid references users(id),
    created_at          timestamptz not null default now(),
    posted_at           timestamptz
);

create table journal_entry_lines (
    id                  uuid primary key default gen_random_uuid(),
    journal_entry_id    uuid not null references journal_entries(id),
    line_no             smallint not null,
    account_id          uuid not null references chart_of_accounts(id),
    debit               numeric(18,2) not null default 0,
    credit              numeric(18,2) not null default 0,
    base_currency_amount numeric(18,2) not null,  -- signed, in company base currency
    department_id       uuid references departments(id),
    cost_centre_id      uuid references cost_centres(id),
    profit_centre_id    uuid references profit_centres(id),
    project_id          uuid,                      -- references projects(id)
    customer_id         uuid,                      -- references customers(id), for AR tie-out
    supplier_id         uuid,                      -- references suppliers(id), for AP tie-out
    tax_code_id         uuid,                       -- references tax_codes(id)
    description         text,
    unique (journal_entry_id, line_no),
    check (not (debit > 0 and credit > 0))
);

-- Materialized running balances — what reports actually query.
create table gl_account_balances (
    id                  uuid primary key default gen_random_uuid(),
    company_id          uuid not null references companies(id),
    accounting_period_id uuid not null references accounting_periods(id),
    account_id          uuid not null references chart_of_accounts(id),
    branch_id           uuid references branches(id),
    department_id       uuid references departments(id),
    cost_centre_id      uuid references cost_centres(id),
    profit_centre_id    uuid references profit_centres(id),
    debit_total         numeric(18,2) not null default 0,
    credit_total        numeric(18,2) not null default 0,
    updated_at          timestamptz not null default now(),
    unique (company_id, accounting_period_id, account_id, branch_id, department_id, cost_centre_id, profit_centre_id)
);

-- ----------------------------------------------------------------------------
-- Row-Level Security — representative policy, applied identically to every
-- tenant-scoped table (companies, branches, journal_entries, etc.)
-- ----------------------------------------------------------------------------

alter table companies enable row level security;
create policy tenant_isolation_companies on companies
    using (tenant_id = current_setting('app.tenant_id', true)::uuid);

alter table journal_entries enable row level security;
create policy tenant_isolation_journal_entries on journal_entries
    using (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- (Every other tenant-scoped table gets the same two lines in the real
--  migration set — omitted here for brevity.)

-- Immutability guard: posted journal entries can never be edited in place.
create or replace function reject_edit_of_posted_journal_entry()
returns trigger as $$
begin
    if old.status = 'posted' then
        raise exception 'journal_entries.%: cannot modify a posted entry; use a reversal or adjustment entry', old.id;
    end if;
    return new;
end;
$$ language plpgsql;

create trigger trg_reject_edit_of_posted_journal_entry
    before update on journal_entries
    for each row execute function reject_edit_of_posted_journal_entry();
