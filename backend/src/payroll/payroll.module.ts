import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { SalaryStructuresController, SalaryStructuresService } from './salary-structures';
import { PayrollRunsController, PayrollRunsService } from './payroll-runs';

@Module({
  imports: [AccountingModule],
  controllers: [SalaryStructuresController, PayrollRunsController],
  providers: [SalaryStructuresService, PayrollRunsService],
})
export class PayrollModule {}
