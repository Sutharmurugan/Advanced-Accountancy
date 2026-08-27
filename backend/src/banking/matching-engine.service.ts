import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface MatchSuggestion {
  suggestedType: 'customer_receipt' | 'supplier_payment';
  suggestedCustomerId?: string;
  suggestedSupplierId?: string;
  suggestedInvoiceId: string;
  confidenceScore: number;
}

const AMOUNT_MATCH_WEIGHT = 70;
const NAME_MATCH_WEIGHT = 30;
const AMOUNT_TOLERANCE = 0.01;

/**
 * A deliberately simple, explainable scoring heuristic — not a machine
 * learning model — per section 9: analyse the bank line's amount and
 * description text against open invoices, and produce a 0-100 confidence
 * score plus a suggested customer/supplier, GL-relevant invoice, and
 * transaction type. High-confidence suggestions can be approved with one
 * click; anything lower is still surfaced, but is expected to get a human
 * look before being turned into a posted receipt/payment.
 */
@Injectable()
export class MatchingEngineService {
  async suggest(
    tx: Prisma.TransactionClient,
    companyId: string,
    description: string,
    amount: number,
  ): Promise<MatchSuggestion | null> {
    if (amount > 0) return this.suggestReceipt(tx, companyId, description, amount);
    if (amount < 0) return this.suggestPayment(tx, companyId, description, -amount);
    return null;
  }

  private async suggestReceipt(
    tx: Prisma.TransactionClient,
    companyId: string,
    description: string,
    amount: number,
  ): Promise<MatchSuggestion | null> {
    const invoices = await tx.salesInvoice.findMany({
      where: { companyId, status: 'posted' },
    });
    const customers = await tx.customer.findMany({
      where: { id: { in: invoices.map((i) => i.customerId) } },
    });
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));
    let best: { invoiceId: string; customerId: string; score: number } | null = null;

    for (const invoice of invoices) {
      const outstanding = Number(invoice.total) - Number(invoice.amountPaid);
      if (outstanding <= 0) continue;

      let score = 0;
      if (Math.abs(outstanding - amount) < AMOUNT_TOLERANCE) score += AMOUNT_MATCH_WEIGHT;
      const customerName = customerNameById.get(invoice.customerId);
      if (customerName && nameMentionedIn(description, customerName)) score += NAME_MATCH_WEIGHT;

      if (score > 0 && (!best || score > best.score)) {
        best = { invoiceId: invoice.id, customerId: invoice.customerId, score };
      }
    }

    if (!best) return null;
    return {
      suggestedType: 'customer_receipt',
      suggestedCustomerId: best.customerId,
      suggestedInvoiceId: best.invoiceId,
      confidenceScore: best.score,
    };
  }

  private async suggestPayment(
    tx: Prisma.TransactionClient,
    companyId: string,
    description: string,
    amount: number,
  ): Promise<MatchSuggestion | null> {
    const invoices = await tx.supplierInvoice.findMany({
      where: { companyId, status: 'posted' },
    });
    const suppliers = await tx.supplier.findMany({
      where: { id: { in: invoices.map((i) => i.supplierId) } },
    });
    const supplierNameById = new Map(suppliers.map((s) => [s.id, s.name]));
    let best: { invoiceId: string; supplierId: string; score: number } | null = null;

    for (const invoice of invoices) {
      const outstanding = Number(invoice.total) - Number(invoice.amountPaid);
      if (outstanding <= 0) continue;

      let score = 0;
      if (Math.abs(outstanding - amount) < AMOUNT_TOLERANCE) score += AMOUNT_MATCH_WEIGHT;
      const supplierName = supplierNameById.get(invoice.supplierId);
      if (supplierName && nameMentionedIn(description, supplierName)) score += NAME_MATCH_WEIGHT;

      if (score > 0 && (!best || score > best.score)) {
        best = { invoiceId: invoice.id, supplierId: invoice.supplierId, score };
      }
    }

    if (!best) return null;
    return {
      suggestedType: 'supplier_payment',
      suggestedSupplierId: best.supplierId,
      suggestedInvoiceId: best.invoiceId,
      confidenceScore: best.score,
    };
  }
}

function nameMentionedIn(description: string, name: string): boolean {
  const normalizedDescription = description.toLowerCase();
  const firstWord = name.toLowerCase().split(/\s+/)[0];
  return firstWord.length > 2 && normalizedDescription.includes(firstWord);
}
