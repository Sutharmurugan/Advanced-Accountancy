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
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { AccountingEngineService } from '../accounting/accounting-engine.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class ReceiptAllocationDto {
  @IsString() salesInvoiceId: string;
  @IsNumber() amount: number;
}

export class CreateCustomerReceiptDto {
  @IsString() companyId: string;
  @IsString() customerId: string;
  @IsString() bankAccountId: string;
  @IsDateString() receiptDate: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptAllocationDto)
  allocations: ReceiptAllocationDto[];
}

@Injectable()
export class CustomerReceiptsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.customerReceipt.findMany({
        where: companyId ? { companyId } : undefined,
        include: { allocations: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateCustomerReceiptDto) {
    const amount = dto.allocations.reduce((s, a) => s + a.amount, 0);
    if (amount <= 0) throw new BadRequestException('Receipt must allocate a positive amount');

    return this.tenantPrisma.run(tenantId, async (tx) => {
      const receiptNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'CUSTOMER_RECEIPT',
        'RCT-',
      );
      const receipt = await tx.customerReceipt.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          customerId: dto.customerId,
          bankAccountId: dto.bankAccountId,
          receiptNumber,
          receiptDate: new Date(dto.receiptDate),
          amount,
          allocations: {
            create: dto.allocations.map((a) => ({
              salesInvoiceId: a.salesInvoiceId,
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
        entityType: 'customer_receipt',
        entityId: receipt.id,
        newValue: { receiptNumber, amount },
      });
      return receipt;
    });
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const receipt = await tx.customerReceipt.findUnique({
        where: { id },
        include: { allocations: true },
      });
      if (!receipt) throw new NotFoundException('Customer receipt not found');
      if (receipt.status !== 'draft') {
        throw new BadRequestException('Only a draft receipt can be posted');
      }

      const bankAccount = await tx.bankAccount.findUnique({
        where: { id: receipt.bankAccountId },
      });
      if (!bankAccount) throw new BadRequestException('Bank account not found');

      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: receipt.companyId,
        eventType: 'CUSTOMER_RECEIPT_POSTED',
        entryDate: receipt.receiptDate,
        currencyCode: bankAccount.currencyCode,
        sourceModule: 'SALES',
        sourceDocType: 'customer_receipt',
        sourceDocId: receipt.id,
        description: `Customer Receipt ${receipt.receiptNumber}`,
        amounts: { amount: Number(receipt.amount) },
        accountOverrides: { bankAccount: bankAccount.glAccountId },
        dimensions: { customerId: receipt.customerId },
        createdBy: userId,
      });

      for (const allocation of receipt.allocations) {
        await tx.salesInvoice.update({
          where: { id: allocation.salesInvoiceId },
          data: { amountPaid: { increment: allocation.amount } },
        });
      }

      const posted = await tx.customerReceipt.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id, postedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: receipt.companyId,
        userId,
        action: 'post',
        entityType: 'customer_receipt',
        entityId: id,
        newValue: { journalEntryId: entry.id },
      });
      return posted;
    });
  }
}

@Controller('customer-receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('sales.manage')
export class CustomerReceiptsController {
  constructor(private readonly customerReceipts: CustomerReceiptsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.customerReceipts.list(user.tenantId, companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerReceiptDto) {
    return this.customerReceipts.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customerReceipts.post(user.tenantId, user.userId, id);
  }
}
