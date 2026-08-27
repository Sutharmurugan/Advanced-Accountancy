import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { QuotationsController, QuotationsService } from './quotations';
import { SalesOrdersController, SalesOrdersService } from './sales-orders';
import { DeliveriesController, DeliveriesService } from './deliveries';
import { SalesInvoicesController, SalesInvoicesService } from './sales-invoices';
import { CustomerReceiptsController, CustomerReceiptsService } from './customer-receipts';
import { CreditNotesController, CreditNotesService } from './credit-notes';

@Module({
  imports: [AccountingModule],
  controllers: [
    QuotationsController,
    SalesOrdersController,
    DeliveriesController,
    SalesInvoicesController,
    CustomerReceiptsController,
    CreditNotesController,
  ],
  providers: [
    QuotationsService,
    SalesOrdersService,
    DeliveriesService,
    SalesInvoicesService,
    CustomerReceiptsService,
    CreditNotesService,
  ],
  exports: [DeliveriesService],
})
export class SalesModule {}
