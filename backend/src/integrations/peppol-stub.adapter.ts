import { Injectable, Logger } from '@nestjs/common';
import { EInvoicingAdapter, EInvoiceSubmissionResult } from './adapters.interface';

/**
 * NOT a real Peppol connection. A real one requires the tenant's business
 * to be registered on the Peppol network and connected through a
 * certified Access Point provider (with its own credentials/certificates)
 * — none of which exists in this environment. This stub exists to prove
 * the adapter seam is real: SalesInvoicesService would call
 * `EInvoicingAdapter.submitInvoice()` after a posted invoice, exactly the
 * same call whether this stub or a real Access Point client is injected,
 * and nothing about the Sales module's own posting logic changes either
 * way. Replacing this with a real client is a Phase 12 follow-up once a
 * business has actual Peppol registration to connect to.
 */
@Injectable()
export class PeppolStubAdapter implements EInvoicingAdapter {
  private readonly logger = new Logger(PeppolStubAdapter.name);

  async submitInvoice(invoice: {
    invoiceNumber: string;
    invoiceDate: string;
    total: number;
    currencyCode: string;
    customerName: string;
  }): Promise<EInvoiceSubmissionResult> {
    this.logger.log(
      `[stub] Would submit invoice ${invoice.invoiceNumber} (${invoice.total} ${invoice.currencyCode}) ` +
        `to ${invoice.customerName} via Peppol — no real Access Point configured.`,
    );
    return { externalId: `stub-${invoice.invoiceNumber}`, status: 'queued' };
  }
}
