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
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { AccountingEngineService } from '../accounting/accounting-engine.service';
import { currentTaxRatePercent, round2 } from '../accounting/tax-rate.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class SupplierInvoiceLineDto {
  @IsOptional() @IsString() productId?: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() quantity: number;
  @IsNumber() unitPrice: number;
  @IsOptional() @IsString() taxCodeId?: string;
}

export class CreateSupplierInvoiceDto {
  @IsString() companyId: string;
  @IsString() supplierId: string;
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsDateString() invoiceDate: string;
  @IsDateString() dueDate: string;
  @IsString() currencyCode: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SupplierInvoiceLineDto)
  lines: SupplierInvoiceLineDto[];
}

/**
 * Mirrors SalesInvoicesService on the purchasing side: posting calls
 * AccountingEngineService.postEvent('PURCHASE_INVOICE_POSTED', ...) — the
 * posting rule decides Expense vs. Input Tax vs. Accounts Payable.
 */
@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.supplierInvoice.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const invoice = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.supplierInvoice.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!invoice) throw new NotFoundException('Supplier invoice not found');
    return invoice;
  }

  create(tenantId: string, userId: string, dto: CreateSupplierInvoiceDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const invoiceDate = new Date(dto.invoiceDate);
      let subtotal = 0;
      let taxAmount = 0;
      const lines = [];
      for (const [idx, line] of dto.lines.entries()) {
        const lineTotal = round2(line.quantity * line.unitPrice);
        const rate = await currentTaxRatePercent(tx, line.taxCodeId, invoiceDate);
        subtotal += lineTotal;
        taxAmount += round2((lineTotal * rate) / 100);
        lines.push({
          lineNo: idx + 1,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxCodeId: line.taxCodeId,
          lineTotal,
        });
      }

      const invoiceNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'SUPPLIER_INVOICE',
        'SINV-',
      );

      const invoice = await tx.supplierInvoice.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          supplierId: dto.supplierId,
          purchaseOrderId: dto.purchaseOrderId,
          invoiceNumber,
          invoiceDate,
          dueDate: new Date(dto.dueDate),
          currencyCode: dto.currencyCode,
          subtotal,
          taxAmount,
          total: subtotal + taxAmount,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'supplier_invoice',
        entityId: invoice.id,
        newValue: { invoiceNumber, total: invoice.total },
      });
      return invoice;
    });
  }

  submit(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, 'draft', 'submitted');
  }

  approve(tenantId: string, userId: string, id: string) {
    return this.transition(tenantId, userId, id, 'submitted', 'approved');
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const invoice = await tx.supplierInvoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Supplier invoice not found');
      if (invoice.status !== 'approved') {
        throw new BadRequestException('Only an approved invoice can be posted');
      }

      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: invoice.companyId,
        eventType: 'PURCHASE_INVOICE_POSTED',
        entryDate: invoice.invoiceDate,
        currencyCode: invoice.currencyCode,
        sourceModule: 'PURCHASING',
        sourceDocType: 'supplier_invoice',
        sourceDocId: invoice.id,
        description: `Supplier Invoice ${invoice.invoiceNumber}`,
        amounts: {
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.taxAmount),
          total: Number(invoice.total),
        },
        dimensions: { supplierId: invoice.supplierId },
        createdBy: userId,
      });

      const posted = await tx.supplierInvoice.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id, postedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: invoice.companyId,
        userId,
        action: 'post',
        entityType: 'supplier_invoice',
        entityId: id,
        newValue: { journalEntryId: entry.id },
      });
      return posted;
    });
  }

  private transition(tenantId: string, userId: string, id: string, from: string, to: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const invoice = await tx.supplierInvoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Supplier invoice not found');
      if (invoice.status !== from) {
        throw new BadRequestException(`Invoice must be ${from} to transition to ${to}`);
      }
      const updated = await tx.supplierInvoice.update({ where: { id }, data: { status: to } });
      await this.audit.record(tx, {
        tenantId,
        companyId: invoice.companyId,
        userId,
        action: 'edit',
        entityType: 'supplier_invoice',
        entityId: id,
        oldValue: { status: from },
        newValue: { status: to },
      });
      return updated;
    });
  }
}

@Controller('supplier-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('purchasing.manage')
export class SupplierInvoicesController {
  constructor(private readonly supplierInvoices: SupplierInvoicesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.supplierInvoices.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.supplierInvoices.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierInvoiceDto) {
    return this.supplierInvoices.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.supplierInvoices.submit(user.tenantId, user.userId, id);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.supplierInvoices.approve(user.tenantId, user.userId, id);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.supplierInvoices.post(user.tenantId, user.userId, id);
  }
}
