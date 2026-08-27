/**
 * Starter Chart of Accounts + posting rules created automatically when a
 * company is created (see CompanyProvisioningService). This is what makes
 * "no duplicated accounting logic anywhere in the system" possible: every
 * module posts through named control-account resolvers here, not through
 * hardcoded GL account numbers of its own.
 *
 * account_resolver syntax understood by AccountingEngineService:
 *  - "CONTROL:<controlType>" — the company's one account tagged with that
 *    controlType (e.g. CONTROL:AR).
 *  - "OVERRIDE:<key>" — an accountId the caller supplies at post time (used
 *    when the account genuinely varies per document, e.g. which specific
 *    bank account a receipt hit, or which asset's own depreciation account).
 */

export interface StarterAccount {
  accountCode: string;
  name: string;
  accountType: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  controlType?: string;
  misCategory?: string;
}

export const STARTER_CHART_OF_ACCOUNTS: StarterAccount[] = [
  { accountCode: '1100', name: 'Accounts Receivable', accountType: 'asset', controlType: 'AR', misCategory: 'AR' },
  { accountCode: '1200', name: 'Inventory', accountType: 'asset', controlType: 'INVENTORY', misCategory: 'INVENTORY' },
  { accountCode: '1300', name: 'Input Tax Receivable', accountType: 'asset', controlType: 'TAX_INPUT' },
  { accountCode: '1500', name: 'Accumulated Depreciation', accountType: 'asset', misCategory: 'ASSET' },
  { accountCode: '1900', name: 'Bank — Default', accountType: 'asset', controlType: 'BANK', misCategory: 'CASH' },
  { accountCode: '2100', name: 'Accounts Payable', accountType: 'liability', controlType: 'AP', misCategory: 'AP' },
  { accountCode: '2200', name: 'Output Tax Payable', accountType: 'liability', controlType: 'TAX_OUTPUT' },
  { accountCode: '2300', name: 'Salary Payable', accountType: 'liability', controlType: 'SALARY_PAYABLE' },
  { accountCode: '2400', name: 'Statutory Payable', accountType: 'liability', controlType: 'STATUTORY_PAYABLE' },
  { accountCode: '3000', name: "Owner's Equity / Retained Earnings", accountType: 'equity', misCategory: 'EQUITY' },
  { accountCode: '4000', name: 'Sales Revenue', accountType: 'income', controlType: 'SALES_REVENUE', misCategory: 'REVENUE' },
  { accountCode: '5000', name: 'Cost of Goods Sold', accountType: 'expense', controlType: 'COGS', misCategory: 'COGS' },
  { accountCode: '5100', name: 'General Purchases / Expense', accountType: 'expense', controlType: 'PURCHASE_EXPENSE', misCategory: 'OPEX' },
  { accountCode: '6000', name: 'Salary Expense', accountType: 'expense', controlType: 'SALARY_EXPENSE', misCategory: 'OPEX' },
  { accountCode: '6100', name: 'Depreciation Expense', accountType: 'expense', misCategory: 'OPEX' },
];

export interface StarterPostingRuleLine {
  lineNo: number;
  side: 'debit' | 'credit';
  accountResolver: string;
  amountSource: string;
}

export interface StarterPostingRule {
  eventType: string;
  lines: StarterPostingRuleLine[];
}

export const STARTER_POSTING_RULES: StarterPostingRule[] = [
  {
    eventType: 'SALES_INVOICE_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:AR', amountSource: 'total' },
      { lineNo: 2, side: 'credit', accountResolver: 'CONTROL:SALES_REVENUE', amountSource: 'subtotal' },
      { lineNo: 3, side: 'credit', accountResolver: 'CONTROL:TAX_OUTPUT', amountSource: 'taxAmount' },
    ],
  },
  {
    eventType: 'PURCHASE_INVOICE_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:PURCHASE_EXPENSE', amountSource: 'subtotal' },
      { lineNo: 2, side: 'debit', accountResolver: 'CONTROL:TAX_INPUT', amountSource: 'taxAmount' },
      { lineNo: 3, side: 'credit', accountResolver: 'CONTROL:AP', amountSource: 'total' },
    ],
  },
  {
    eventType: 'CUSTOMER_RECEIPT_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'OVERRIDE:bankAccount', amountSource: 'amount' },
      { lineNo: 2, side: 'credit', accountResolver: 'CONTROL:AR', amountSource: 'amount' },
    ],
  },
  {
    eventType: 'SUPPLIER_PAYMENT_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:AP', amountSource: 'amount' },
      { lineNo: 2, side: 'credit', accountResolver: 'OVERRIDE:bankAccount', amountSource: 'amount' },
    ],
  },
  {
    eventType: 'CREDIT_NOTE_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:SALES_REVENUE', amountSource: 'amount' },
      { lineNo: 2, side: 'credit', accountResolver: 'CONTROL:AR', amountSource: 'amount' },
    ],
  },
  {
    eventType: 'DEBIT_NOTE_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:AP', amountSource: 'amount' },
      { lineNo: 2, side: 'credit', accountResolver: 'CONTROL:PURCHASE_EXPENSE', amountSource: 'amount' },
    ],
  },
  {
    eventType: 'DELIVERY_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:COGS', amountSource: 'cost' },
      { lineNo: 2, side: 'credit', accountResolver: 'CONTROL:INVENTORY', amountSource: 'cost' },
    ],
  },
  {
    eventType: 'PAYROLL_RUN_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:SALARY_EXPENSE', amountSource: 'totalGross' },
      { lineNo: 2, side: 'credit', accountResolver: 'CONTROL:SALARY_PAYABLE', amountSource: 'totalNet' },
      { lineNo: 3, side: 'credit', accountResolver: 'CONTROL:STATUTORY_PAYABLE', amountSource: 'totalDeductions' },
    ],
  },
  {
    eventType: 'ASSET_DEPRECIATION_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'OVERRIDE:depreciationExpenseAccount', amountSource: 'amount' },
      { lineNo: 2, side: 'credit', accountResolver: 'OVERRIDE:accumulatedDepreciationAccount', amountSource: 'amount' },
    ],
  },
  {
    // A stock count variance is signed: only one of increaseAmount /
    // decreaseAmount is ever non-zero for a given adjustment (see
    // InventoryService.recordAdjustment), so exactly one debit/credit pair
    // below actually posts — the other two lines are skipped as zero-amount
    // by the engine, keeping the entry balanced either way.
    eventType: 'INVENTORY_ADJUSTMENT_POSTED',
    lines: [
      { lineNo: 1, side: 'debit', accountResolver: 'CONTROL:INVENTORY', amountSource: 'increaseAmount' },
      { lineNo: 2, side: 'credit', accountResolver: 'CONTROL:COGS', amountSource: 'increaseAmount' },
      { lineNo: 3, side: 'debit', accountResolver: 'CONTROL:COGS', amountSource: 'decreaseAmount' },
      { lineNo: 4, side: 'credit', accountResolver: 'CONTROL:INVENTORY', amountSource: 'decreaseAmount' },
    ],
  },
];
