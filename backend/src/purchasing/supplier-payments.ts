import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNumber, IsString, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { AccountingEngineService } from '../accounting/accounting-engine.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class PaymentAllocationDto {
  @IsString() supplierInvoiceId: string;
  @IsNumber() amount: number;
}

export class CreateSupplierPaymentDto {
  @IsString() companyId: string;
  @IsString() supplierId: string;
  @IsString() bankAccountId: string;
  @IsDateString() paymentDate: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationDto)
  allocations: PaymentAllocationDto[];
}

@Injectable()
export class SupplierPaymentsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.supplierPayment.findMany({
        where: companyId ? { companyId } : undefined,
        include: { allocations: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateSupplierPaymentDto) {
    const amount = dto.allocations.reduce((s, a) => s + a.amount, 0);
    if (amount <= 0) throw new BadRequestException('Payment must allocate a positive amount');

    return this.tenantPrisma.run(tenantId, async (tx) => {
      const paymentNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'SUPPLIER_PAYMENT',
        'PAY-',
      );
      const payment = await tx.supplierPayment.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          supplierId: dto.supplierId,
          bankAccountId: dto.bankAccountId,
          paymentNumber,
          paymentDate: new Date(dto.paymentDate),
          amount,
          allocations: {
            create: dto.allocations.map((a) => ({
              supplierInvoiceId: a.supplierInvoiceId,
              amount: a.amount,
            })),
          },
        },
        include: { allocations: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'supplier_payment',
        entityId: payment.id,
        newValue: { paymentNumber, amount },
      });
      return payment;
    });
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const payment = await tx.supplierPayment.findUnique({
        where: { id },
        include: { allocations: true },
      });
      if (!payment) throw new NotFoundException('Supplier payment not found');
      if (payment.status !== 'draft') {
        throw new BadRequestException('Only a draft payment can be posted');
      }

      const bankAccount = await tx.bankAccount.findUnique({
        where: { id: payment.bankAccountId },
      });
      if (!bankAccount) throw new BadRequestException('Bank account not found');

      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: payment.companyId,
        eventType: 'SUPPLIER_PAYMENT_POSTED',
        entryDate: payment.paymentDate,
        currencyCode: bankAccount.currencyCode,
        sourceModule: 'PURCHASING',
        sourceDocType: 'supplier_payment',
        sourceDocId: payment.id,
        description: `Supplier Payment ${payment.paymentNumber}`,
        amounts: { amount: Number(payment.amount) },
        accountOverrides: { bankAccount: bankAccount.glAccountId },
        dimensions: { supplierId: payment.supplierId },
        createdBy: userId,
      });

      for (const allocation of payment.allocations) {
        await tx.supplierInvoice.update({
          where: { id: allocation.supplierInvoiceId },
          data: { amountPaid: { increment: allocation.amount } },
        });
      }

      const posted = await tx.supplierPayment.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id, postedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: payment.companyId,
        userId,
        action: 'post',
        entityType: 'supplier_payment',
        entityId: id,
        newValue: { journalEntryId: entry.id },
      });
      return posted;
    });
  }
}

@Controller('supplier-payments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('purchasing.manage')
export class SupplierPaymentsController {
  constructor(private readonly supplierPayments: SupplierPaymentsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.supplierPayments.list(user.tenantId, companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierPaymentDto) {
    return this.supplierPayments.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.supplierPayments.post(user.tenantId, user.userId, id);
  }
}
