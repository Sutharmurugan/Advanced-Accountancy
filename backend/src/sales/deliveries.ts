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
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
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
 * Delivery posting (stock-out + COGS via DELIVERY_POSTED) is wired in
 * src/inventory/deliveries-posting.service.ts, added with Phase 6 once
 * weighted-average valuation exists — see that file for why it's a
 * separate piece rather than duplicated here.
 */
@Injectable()
export class DeliveriesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
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
}
