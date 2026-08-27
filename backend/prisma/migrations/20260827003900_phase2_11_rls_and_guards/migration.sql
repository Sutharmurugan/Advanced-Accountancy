-- ============================================================================
-- Phase 2-11 — Row-Level Security for every new tenant-scoped table.
-- Same pattern as prisma/migrations/*_rls_and_guards for Phase 1: grant CRUD
-- to omnierp_app, enable + force RLS, and a policy scoped either directly
-- (tables with their own tenant_id) or through a parent table's tenant_id
-- (line/child tables with no tenant_id column of their own).
-- ============================================================================

grant select, insert, update, delete on
  public.exchange_rates,
  public.chart_of_accounts,
  public.tax_codes,
  public.payment_terms,
  public.bank_accounts,
  public.customers,
  public.suppliers,
  public.employees,
  public.product_categories,
  public.brands,
  public.uoms,
  public.products,
  public.price_lists,
  public.salespersons,
  public.projects,
  public.fiscal_years,
  public.accounting_periods,
  public.document_number_sequences,
  public.posting_rules,
  public.journal_entries,
  public.gl_account_balances,
  public.quotations,
  public.sales_orders,
  public.deliveries,
  public.sales_invoices,
  public.customer_receipts,
  public.credit_notes,
  public.purchase_requests,
  public.purchase_orders,
  public.goods_receipts,
  public.supplier_invoices,
  public.supplier_payments,
  public.debit_notes,
  public.stock_moves,
  public.stock_balances,
  public.stock_counts,
  public.bank_statements,
  public.salary_structures,
  public.payroll_runs,
  public.fixed_assets,
  public.budgets,
  public.intercompany_transactions,
  public.consolidation_runs,
  public.tax_rates,
  public.price_list_items,
  public.posting_rule_lines,
  public.journal_entry_lines,
  public.quotation_lines,
  public.sales_order_lines,
  public.delivery_lines,
  public.sales_invoice_lines,
  public.customer_receipt_allocations,
  public.purchase_request_lines,
  public.purchase_order_lines,
  public.goods_receipt_lines,
  public.supplier_invoice_lines,
  public.supplier_payment_allocations,
  public.stock_count_lines,
  public.bank_statement_lines,
  public.payslips,
  public.depreciation_schedules,
  public.budget_lines,
  public.consolidated_trial_balance_lines
to omnierp_app;

alter table public.exchange_rates enable row level security;
alter table public.exchange_rates force row level security;
alter table public.chart_of_accounts enable row level security;
alter table public.chart_of_accounts force row level security;
alter table public.tax_codes enable row level security;
alter table public.tax_codes force row level security;
alter table public.payment_terms enable row level security;
alter table public.payment_terms force row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_accounts force row level security;
alter table public.customers enable row level security;
alter table public.customers force row level security;
alter table public.suppliers enable row level security;
alter table public.suppliers force row level security;
alter table public.employees enable row level security;
alter table public.employees force row level security;
alter table public.product_categories enable row level security;
alter table public.product_categories force row level security;
alter table public.brands enable row level security;
alter table public.brands force row level security;
alter table public.uoms enable row level security;
alter table public.uoms force row level security;
alter table public.products enable row level security;
alter table public.products force row level security;
alter table public.price_lists enable row level security;
alter table public.price_lists force row level security;
alter table public.salespersons enable row level security;
alter table public.salespersons force row level security;
alter table public.projects enable row level security;
alter table public.projects force row level security;
alter table public.fiscal_years enable row level security;
alter table public.fiscal_years force row level security;
alter table public.accounting_periods enable row level security;
alter table public.accounting_periods force row level security;
alter table public.document_number_sequences enable row level security;
alter table public.document_number_sequences force row level security;
alter table public.posting_rules enable row level security;
alter table public.posting_rules force row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_entries force row level security;
alter table public.gl_account_balances enable row level security;
alter table public.gl_account_balances force row level security;
alter table public.quotations enable row level security;
alter table public.quotations force row level security;
alter table public.sales_orders enable row level security;
alter table public.sales_orders force row level security;
alter table public.deliveries enable row level security;
alter table public.deliveries force row level security;
alter table public.sales_invoices enable row level security;
alter table public.sales_invoices force row level security;
alter table public.customer_receipts enable row level security;
alter table public.customer_receipts force row level security;
alter table public.credit_notes enable row level security;
alter table public.credit_notes force row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_requests force row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_orders force row level security;
alter table public.goods_receipts enable row level security;
alter table public.goods_receipts force row level security;
alter table public.supplier_invoices enable row level security;
alter table public.supplier_invoices force row level security;
alter table public.supplier_payments enable row level security;
alter table public.supplier_payments force row level security;
alter table public.debit_notes enable row level security;
alter table public.debit_notes force row level security;
alter table public.stock_moves enable row level security;
alter table public.stock_moves force row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_balances force row level security;
alter table public.stock_counts enable row level security;
alter table public.stock_counts force row level security;
alter table public.bank_statements enable row level security;
alter table public.bank_statements force row level security;
alter table public.salary_structures enable row level security;
alter table public.salary_structures force row level security;
alter table public.payroll_runs enable row level security;
alter table public.payroll_runs force row level security;
alter table public.fixed_assets enable row level security;
alter table public.fixed_assets force row level security;
alter table public.budgets enable row level security;
alter table public.budgets force row level security;
alter table public.intercompany_transactions enable row level security;
alter table public.intercompany_transactions force row level security;
alter table public.consolidation_runs enable row level security;
alter table public.consolidation_runs force row level security;
alter table public.tax_rates enable row level security;
alter table public.tax_rates force row level security;
alter table public.price_list_items enable row level security;
alter table public.price_list_items force row level security;
alter table public.posting_rule_lines enable row level security;
alter table public.posting_rule_lines force row level security;
alter table public.journal_entry_lines enable row level security;
alter table public.journal_entry_lines force row level security;
alter table public.quotation_lines enable row level security;
alter table public.quotation_lines force row level security;
alter table public.sales_order_lines enable row level security;
alter table public.sales_order_lines force row level security;
alter table public.delivery_lines enable row level security;
alter table public.delivery_lines force row level security;
alter table public.sales_invoice_lines enable row level security;
alter table public.sales_invoice_lines force row level security;
alter table public.customer_receipt_allocations enable row level security;
alter table public.customer_receipt_allocations force row level security;
alter table public.purchase_request_lines enable row level security;
alter table public.purchase_request_lines force row level security;
alter table public.purchase_order_lines enable row level security;
alter table public.purchase_order_lines force row level security;
alter table public.goods_receipt_lines enable row level security;
alter table public.goods_receipt_lines force row level security;
alter table public.supplier_invoice_lines enable row level security;
alter table public.supplier_invoice_lines force row level security;
alter table public.supplier_payment_allocations enable row level security;
alter table public.supplier_payment_allocations force row level security;
alter table public.stock_count_lines enable row level security;
alter table public.stock_count_lines force row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.bank_statement_lines force row level security;
alter table public.payslips enable row level security;
alter table public.payslips force row level security;
alter table public.depreciation_schedules enable row level security;
alter table public.depreciation_schedules force row level security;
alter table public.budget_lines enable row level security;
alter table public.budget_lines force row level security;
alter table public.consolidated_trial_balance_lines enable row level security;
alter table public.consolidated_trial_balance_lines force row level security;

create policy tenant_isolation on public.exchange_rates
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.chart_of_accounts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.tax_codes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.payment_terms
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.bank_accounts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.customers
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.suppliers
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.employees
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.product_categories
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.brands
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.uoms
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.products
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.price_lists
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.salespersons
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.projects
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.fiscal_years
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.accounting_periods
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.document_number_sequences
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.posting_rules
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.journal_entries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.gl_account_balances
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.quotations
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.sales_orders
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.deliveries
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.sales_invoices
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.customer_receipts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.credit_notes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.purchase_requests
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.purchase_orders
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.goods_receipts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.supplier_invoices
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.supplier_payments
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.debit_notes
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.stock_moves
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.stock_balances
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.stock_counts
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.bank_statements
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.salary_structures
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.payroll_runs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.fixed_assets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.budgets
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.intercompany_transactions
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.consolidation_runs
  using (tenant_id = nullif(current_setting('app.tenant_id', true), ''));

create policy tenant_isolation on public.tax_rates
  using (
    tax_code_id in (
      select id from public.tax_codes
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.price_list_items
  using (
    price_list_id in (
      select id from public.price_lists
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.posting_rule_lines
  using (
    posting_rule_id in (
      select id from public.posting_rules
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.journal_entry_lines
  using (
    journal_entry_id in (
      select id from public.journal_entries
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.quotation_lines
  using (
    quotation_id in (
      select id from public.quotations
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.sales_order_lines
  using (
    sales_order_id in (
      select id from public.sales_orders
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.delivery_lines
  using (
    delivery_id in (
      select id from public.deliveries
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.sales_invoice_lines
  using (
    sales_invoice_id in (
      select id from public.sales_invoices
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.customer_receipt_allocations
  using (
    customer_receipt_id in (
      select id from public.customer_receipts
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.purchase_request_lines
  using (
    purchase_request_id in (
      select id from public.purchase_requests
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.purchase_order_lines
  using (
    purchase_order_id in (
      select id from public.purchase_orders
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.goods_receipt_lines
  using (
    goods_receipt_id in (
      select id from public.goods_receipts
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.supplier_invoice_lines
  using (
    supplier_invoice_id in (
      select id from public.supplier_invoices
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.supplier_payment_allocations
  using (
    supplier_payment_id in (
      select id from public.supplier_payments
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.stock_count_lines
  using (
    stock_count_id in (
      select id from public.stock_counts
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.bank_statement_lines
  using (
    bank_statement_id in (
      select id from public.bank_statements
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.payslips
  using (
    payroll_run_id in (
      select id from public.payroll_runs
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.depreciation_schedules
  using (
    fixed_asset_id in (
      select id from public.fixed_assets
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.budget_lines
  using (
    budget_id in (
      select id from public.budgets
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );

create policy tenant_isolation on public.consolidated_trial_balance_lines
  using (
    consolidation_run_id in (
      select id from public.consolidation_runs
      where tenant_id = nullif(current_setting('app.tenant_id', true), '')
    )
  );



-- ----------------------------------------------------------------------------
-- Journal entries: once posted, immutable. Corrections are a reversal or a
-- new adjustment entry (section D), never an UPDATE on a posted row.
-- ----------------------------------------------------------------------------

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
  before update on public.journal_entries
  for each row execute function reject_edit_of_posted_journal_entry();

-- Journal entry lines follow the same rule, keyed off their parent's status.
create or replace function reject_edit_of_posted_journal_entry_line()
returns trigger as $$
declare
  parent_status text;
begin
  select status into parent_status from public.journal_entries where id = old.journal_entry_id;
  if parent_status = 'posted' then
    raise exception 'journal_entry_lines: cannot modify a line of a posted journal entry (%)', old.journal_entry_id;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger trg_reject_edit_of_posted_journal_entry_line
  before update or delete on public.journal_entry_lines
  for each row execute function reject_edit_of_posted_journal_entry_line();
