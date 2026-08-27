import { Module } from '@nestjs/common';
import { SalesModule } from '../sales/sales.module';
import { PurchasingModule } from '../purchasing/purchasing.module';
import { MatchingEngineService } from './matching-engine.service';
import { BankStatementsController, BankStatementsService } from './bank-statements';

@Module({
  imports: [SalesModule, PurchasingModule],
  controllers: [BankStatementsController],
  providers: [MatchingEngineService, BankStatementsService],
  exports: [BankStatementsService],
})
export class BankingModule {}
