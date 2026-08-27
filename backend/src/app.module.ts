import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './auth/auth.module';
import { KernelModule } from './kernel/kernel.module';
import { AccountingModule } from './accounting/accounting.module';
import { MasterdataModule } from './masterdata/masterdata.module';
import { SalesModule } from './sales/sales.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { InventoryModule } from './inventory/inventory.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    AuthModule,
    AccountingModule,
    MasterdataModule,
    InventoryModule,
    SalesModule,
    PurchasingModule,
    KernelModule,
  ],
})
export class AppModule {}
