import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PurchaseRequestsController, PurchaseRequestsService } from './purchase-requests';
import { PurchaseOrdersController, PurchaseOrdersService } from './purchase-orders';
import { GoodsReceiptsController, GoodsReceiptsService } from './goods-receipts';
import { SupplierInvoicesController, SupplierInvoicesService } from './supplier-invoices';
import { SupplierPaymentsController, SupplierPaymentsService } from './supplier-payments';
import { DebitNotesController, DebitNotesService } from './debit-notes';

@Module({
  imports: [AccountingModule],
  controllers: [
    PurchaseRequestsController,
    PurchaseOrdersController,
    GoodsReceiptsController,
    SupplierInvoicesController,
    SupplierPaymentsController,
    DebitNotesController,
  ],
  providers: [
    PurchaseRequestsService,
    PurchaseOrdersService,
    GoodsReceiptsService,
    SupplierInvoicesService,
    SupplierPaymentsService,
    DebitNotesService,
  ],
  exports: [GoodsReceiptsService],
})
export class PurchasingModule {}
