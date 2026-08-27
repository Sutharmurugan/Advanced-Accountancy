import {
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
import { currentTaxRatePercent, round2 } from '../accounting/tax-rate.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class PurchaseOrderLineDto {
  @IsString() productId: string;
  @IsNumber() quantity: number;
  @IsNumber() unitPrice: number;
  @IsOptional() @IsString() taxCodeId?: string;
}

export class CreatePurchaseOrderDto {
  @IsString() companyId: string;
  @IsString() supplierId: string;
  @IsOptional() @IsString() purchaseRequestId?: string;
  @IsDateString() orderDate: string;
  @IsString() currencyCode: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines: PurchaseOrderLineDto[];
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.purchaseOrder.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const order = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.purchaseOrder.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  create(tenantId: string, userId: string, dto: CreatePurchaseOrderDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const orderDate = new Date(dto.orderDate);
      let subtotal = 0;
      let taxAmount = 0;
      const lines = [];
      for (const [idx, line] of dto.lines.entries()) {
        const lineTotal = round2(line.quantity * line.unitPrice);
        const rate = await currentTaxRatePercent(tx, line.taxCodeId, orderDate);
        subtotal += lineTotal;
        taxAmount += round2((lineTotal * rate) / 100);
        lines.push({
          lineNo: idx + 1,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxCodeId: line.taxCodeId,
          lineTotal,
        });
      }

      const orderNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'PURCHASE_ORDER',
        'PO-',
      );

      const order = await tx.purchaseOrder.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          supplierId: dto.supplierId,
          purchaseRequestId: dto.purchaseRequestId,
          orderNumber,
          orderDate,
          currencyCode: dto.currencyCode,
          status: 'confirmed',
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
        entityType: 'purchase_order',
        entityId: order.id,
        newValue: { orderNumber, total: order.total },
      });
      return order;
    });
  }
}

@Controller('purchase-orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('purchasing.manage')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrders: PurchaseOrdersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.purchaseOrders.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purchaseOrders.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseOrderDto) {
    return this.purchaseOrders.create(user.tenantId, user.userId, dto);
  }
}
