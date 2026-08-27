import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { FixedAssetsController, FixedAssetsService } from './fixed-assets';
import { BudgetsController, BudgetsService } from './budgets';

@Module({
  imports: [AccountingModule],
  controllers: [FixedAssetsController, BudgetsController],
  providers: [FixedAssetsService, BudgetsService],
})
export class AssetsModule {}
