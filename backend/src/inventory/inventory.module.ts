import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { InventoryService } from './inventory.service';
import { StockBalancesController, StockMovesController } from './stock-balances';
import { StockCountsController, StockCountsService } from './stock-counts';

@Module({
  imports: [AccountingModule],
  controllers: [StockBalancesController, StockMovesController, StockCountsController],
  providers: [InventoryService, StockCountsService],
  exports: [InventoryService],
})
export class InventoryModule {}
