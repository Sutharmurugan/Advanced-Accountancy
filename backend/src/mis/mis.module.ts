import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { MisController } from './mis.controller';
import { MisService } from './mis.service';

@Module({
  imports: [AccountingModule],
  controllers: [MisController],
  providers: [MisService],
})
export class MisModule {}
