/**
 * Phase 12 — integration adapter contracts (section 12 / architecture
 * section F). The rule this phase exists to prove: "each integration is
 * an adapter with zero changes to the core accounting engine." Every
 * adapter here translates an external format into the exact same internal
 * shape the relevant module already accepts — Sales, Purchasing, Banking
 * and the Accounting Engine never know or care whether a document came
 * from a human filling in a form or an adapter.
 *
 * What's real in this phase: CsvBankFeedAdapter genuinely parses a CSV
 * bank export into BankStatementsService.import()'s input shape — no
 * network access needed, so it's fully implemented and tested.
 *
 * What's a documented stub: e-invoicing (Peppol) and attendance devices
 * both need real, certified external access this environment doesn't
 * have — a Peppol Access Point requires business registration and a
 * certified connection, and an attendance device integration needs actual
 * hardware or a vendor API. Their adapters here define the contract a real
 * implementation would fulfil and simulate its behavior in-memory, so the
 * seam is provably in place without pretending to talk to a real service.
 */

export interface BankFeedLine {
  transactionDate: string; // ISO date
  description: string;
  amount: number; // signed: positive = money in, negative = money out
}

export interface BankFeedAdapter {
  /** Returns the statement lines found in whatever the adapter's source
   * format is, normalized to BankStatementsService.import()'s line shape. */
  parse(raw: string): BankFeedLine[];
}

export interface EInvoiceSubmissionResult {
  externalId: string;
  status: 'queued' | 'accepted' | 'rejected';
}

export interface EInvoicingAdapter {
  /** Submits a posted Sales Invoice for e-invoicing delivery (e.g. via a
   * Peppol Access Point). Never called before the invoice is posted in
   * OmniERP's own ledger — e-invoicing is a delivery channel, not an
   * accounting event. */
  submitInvoice(invoice: {
    invoiceNumber: string;
    invoiceDate: string;
    total: number;
    currencyCode: string;
    customerName: string;
  }): Promise<EInvoiceSubmissionResult>;
}

export interface AttendanceEvent {
  employeeCode: string;
  eventType: 'clock_in' | 'clock_out';
  timestamp: string; // ISO datetime
}

export interface AttendanceDeviceAdapter {
  /** Pulls raw punches since a given time — a real implementation polls a
   * vendor API or reads a device's export file; Payroll only ever sees
   * normalized AttendanceEvent rows regardless of source. */
  pullEvents(sinceIso: string): Promise<AttendanceEvent[]>;
}
