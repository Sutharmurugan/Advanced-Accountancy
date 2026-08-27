import { Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';
import { AccountingEngineService } from './accounting-engine.service';
import { CompanyProvisioningService } from './company-provisioning.service';
import { ChartOfAccountsController } from './chart-of-accounts/chart-of-accounts.controller';
import { ChartOfAccountsService } from './chart-of-accounts/chart-of-accounts.service';
import { FiscalPeriodsController } from './fiscal-periods/fiscal-periods.controller';
import { FiscalPeriodsService } from './fiscal-periods/fiscal-periods.service';
import { JournalEntriesController } from './journal-entries/journal-entries.controller';
import { JournalEntriesService } from './journal-entries/journal-entries.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

@Module({
  controllers: [
    ChartOfAccountsController,
    FiscalPeriodsController,
    JournalEntriesController,
    ReportsController,
  ],
  providers: [
    NumberingService,
    AccountingEngineService,
    CompanyProvisioningService,
    ChartOfAccountsService,
    FiscalPeriodsService,
    JournalEntriesService,
    ReportsService,
  ],
  exports: [
    NumberingService,
    AccountingEngineService,
    CompanyProvisioningService,
    ReportsService,
  ],
})
export class AccountingModule {}
