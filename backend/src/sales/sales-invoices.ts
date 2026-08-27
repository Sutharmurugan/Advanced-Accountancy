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

export class SalesInvoiceLineDto {
  @IsString() productId: string;
  @IsOptional() @IsString() description?: string;
  @IsNumber() quantity: number;
  @IsNumber() unitPrice: number;
  @IsOptional() @IsString() taxCodeId?: string;
}

export class CreateSalesInvoiceDto {
  @IsString() companyId: string;
  @IsString() customerId: string;
  @IsOptional() @IsString() salesOrderId?: string;
  @IsDateString() invoiceDate: string;
  @IsDateString() dueDate: string;
  @IsString() currencyCode: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesInvoiceLineDto)
  lines: SalesInvoiceLineDto[];
}

/**
 * Sales Invoice is where Sales actually touches the ledger: posting calls
 * AccountingEngineService.postEvent('SALES_INVOICE_POSTED', ...) with the
 * business amounts only — the posting rule seeded by
 * CompanyProvisioningService decides which accounts get hit (section D).
 * This module never references a GL account id.
 */
@Injectable()
export class SalesInvoicesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.salesInvoice.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const invoice = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.salesInvoice.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!invoice) throw new NotFoundException('Sales invoice not found');
    return invoice;
  }

  create(tenantId: string, userId: string, dto: CreateSalesInvoiceDto) {
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
        'SALES_INVOICE',
        'INV-',
      );

      const invoice = await tx.salesInvoice.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          customerId: dto.customerId,
          salesOrderId: dto.salesOrderId,
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
        entityType: 'sales_invoice',
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
      const invoice = await tx.salesInvoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Sales invoice not found');
      if (invoice.status !== 'approved') {
        throw new BadRequestException('Only an approved invoice can be posted');
      }

      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: invoice.companyId,
        eventType: 'SALES_INVOICE_POSTED',
        entryDate: invoice.invoiceDate,
        currencyCode: invoice.currencyCode,
        sourceModule: 'SALES',
        sourceDocType: 'sales_invoice',
        sourceDocId: invoice.id,
        description: `Sales Invoice ${invoice.invoiceNumber}`,
        amounts: {
          subtotal: Number(invoice.subtotal),
          taxAmount: Number(invoice.taxAmount),
          total: Number(invoice.total),
        },
        dimensions: { customerId: invoice.customerId },
        createdBy: userId,
      });

      const posted = await tx.salesInvoice.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id, postedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: invoice.companyId,
        userId,
        action: 'post',
        entityType: 'sales_invoice',
        entityId: id,
        newValue: { journalEntryId: entry.id },
      });
      return posted;
    });
  }

  private transition(
    tenantId: string,
    userId: string,
    id: string,
    from: string,
    to: string,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const invoice = await tx.salesInvoice.findUnique({ where: { id } });
      if (!invoice) throw new NotFoundException('Sales invoice not found');
      if (invoice.status !== from) {
        throw new BadRequestException(`Invoice must be ${from} to transition to ${to}`);
      }
      const updated = await tx.salesInvoice.update({ where: { id }, data: { status: to } });
      await this.audit.record(tx, {
        tenantId,
        companyId: invoice.companyId,
        userId,
        action: 'edit',
        entityType: 'sales_invoice',
        entityId: id,
        oldValue: { status: from },
        newValue: { status: to },
      });
      return updated;
    });
  }
}

@Controller('sales-invoices')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('sales.manage')
export class SalesInvoicesController {
  constructor(private readonly salesInvoices: SalesInvoicesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.salesInvoices.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salesInvoices.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalesInvoiceDto) {
    return this.salesInvoices.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salesInvoices.submit(user.tenantId, user.userId, id);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salesInvoices.approve(user.tenantId, user.userId, id);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.salesInvoices.post(user.tenantId, user.userId, id);
  }
}
