import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import {
  IntercompanyTransactionsController,
  IntercompanyTransactionsService,
} from './intercompany-transactions';
import { ConsolidationRunsController, ConsolidationRunsService } from './consolidation-runs';

@Module({
  imports: [AccountingModule],
  controllers: [IntercompanyTransactionsController, ConsolidationRunsController],
  providers: [IntercompanyTransactionsService, ConsolidationRunsService],
})
export class ConsolidationModule {}
