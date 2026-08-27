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
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { AccountingEngineService } from '../accounting/accounting-engine.service';
import { InventoryService } from '../inventory/inventory.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class DeliveryLineDto {
  @IsString() productId: string;
  @IsNumber() quantity: number;
}

export class CreateDeliveryDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() salesOrderId?: string;
  @IsString() warehouseId: string;
  @IsDateString() deliveryDate: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DeliveryLineDto)
  lines: DeliveryLineDto[];
}

/**
 * Delivery.post() is Phase 6's inventory/COGS wiring: it draws stock out at
 * the current weighted-average cost (InventoryService), then posts
 * DELIVERY_POSTED (Debit COGS, Credit Inventory) for that total cost. This
 * is why Delivery has to stay a draft -> posted document rather than
 * something created and forgotten — the COGS entry can't exist before the
 * warehouse actually has a cost to draw from.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly inventory: InventoryService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.delivery.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const delivery = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.delivery.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!delivery) throw new NotFoundException('Delivery not found');
    return delivery;
  }

  create(tenantId: string, userId: string, dto: CreateDeliveryDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const deliveryNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'DELIVERY',
        'DO-',
      );
      const delivery = await tx.delivery.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          salesOrderId: dto.salesOrderId,
          warehouseId: dto.warehouseId,
          deliveryNumber,
          deliveryDate: new Date(dto.deliveryDate),
          lines: {
            create: dto.lines.map((l, idx) => ({
              lineNo: idx + 1,
              productId: l.productId,
              quantity: l.quantity,
            })),
          },
        },
        include: { lines: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'delivery',
        entityId: delivery.id,
        newValue: { deliveryNumber },
      });
      return delivery;
    });
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const delivery = await tx.delivery.findUnique({ where: { id }, include: { lines: true } });
      if (!delivery) throw new NotFoundException('Delivery not found');
      if (delivery.status !== 'draft') {
        throw new BadRequestException('Only a draft delivery can be posted');
      }

      let totalCost = 0;
      for (const line of delivery.lines) {
        const { totalCost: lineCost } = await this.inventory.recordStockOut(
          tx,
          {
            tenantId,
            companyId: delivery.companyId,
            warehouseId: delivery.warehouseId,
            productId: line.productId,
            sourceModule: 'SALES',
            sourceDocType: 'delivery',
            sourceDocId: delivery.id,
            moveDate: delivery.deliveryDate,
          },
          Number(line.quantity),
        );
        totalCost += lineCost;
      }

      const company = await tx.company.findUniqueOrThrow({ where: { id: delivery.companyId } });
      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: delivery.companyId,
        eventType: 'DELIVERY_POSTED',
        entryDate: delivery.deliveryDate,
        currencyCode: company.baseCurrencyCode,
        sourceModule: 'SALES',
        sourceDocType: 'delivery',
        sourceDocId: delivery.id,
        description: `Delivery ${delivery.deliveryNumber}`,
        amounts: { cost: totalCost },
        createdBy: userId,
      });

      const posted = await tx.delivery.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: delivery.companyId,
        userId,
        action: 'post',
        entityType: 'delivery',
        entityId: id,
        newValue: { journalEntryId: entry.id, totalCost },
      });
      return posted;
    });
  }
}

@Controller('deliveries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('sales.manage')
export class DeliveriesController {
  constructor(private readonly deliveries: DeliveriesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.deliveries.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.deliveries.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDeliveryDto) {
    return this.deliveries.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.deliveries.post(user.tenantId, user.userId, id);
  }
}
