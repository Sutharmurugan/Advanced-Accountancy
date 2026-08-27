import { Module } from '@nestjs/common';
import { BankingModule } from '../banking/banking.module';
import { IntegrationsController } from './integrations.controller';
import { CsvBankFeedAdapter } from './csv-bank-feed.adapter';
import { PeppolStubAdapter } from './peppol-stub.adapter';
import { AttendanceStubAdapter } from './attendance-stub.adapter';

@Module({
  imports: [BankingModule],
  controllers: [IntegrationsController],
  providers: [CsvBankFeedAdapter, PeppolStubAdapter, AttendanceStubAdapter],
})
export class IntegrationsModule {}
