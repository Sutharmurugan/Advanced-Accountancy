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
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class StockCountLineDto {
  @IsString() productId: string;
  @IsNumber() countedQuantity: number;
}

export class CreateStockCountDto {
  @IsString() companyId: string;
  @IsString() warehouseId: string;
  @IsDateString() countDate: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StockCountLineDto)
  lines: StockCountLineDto[];
}

/**
 * A physical stock count. The system quantity for each line is captured at
 * creation time (the "expected" figure the count is checking); posting
 * applies the variance via InventoryService.recordAdjustment and posts one
 * INVENTORY_ADJUSTMENT_POSTED entry per company for the net effect.
 */
@Injectable()
export class StockCountsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly inventory: InventoryService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.stockCount.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateStockCountDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const countNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'STOCK_COUNT',
        'SC-',
      );

      const lines = [];
      for (const [idx, line] of dto.lines.entries()) {
        const balance = await tx.stockBalance.findUnique({
          where: {
            warehouseId_productId: { warehouseId: dto.warehouseId, productId: line.productId },
          },
        });
        lines.push({
          lineNo: idx + 1,
          productId: line.productId,
          systemQuantity: balance ? balance.quantityOnHand : 0,
          countedQuantity: line.countedQuantity,
        });
      }

      const stockCount = await tx.stockCount.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          warehouseId: dto.warehouseId,
          countNumber,
          countDate: new Date(dto.countDate),
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'stock_count',
        entityId: stockCount.id,
        newValue: { countNumber },
      });
      return stockCount;
    });
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const stockCount = await tx.stockCount.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!stockCount) throw new NotFoundException('Stock count not found');
      if (stockCount.status !== 'draft') {
        throw new BadRequestException('Only a draft stock count can be posted');
      }

      let increaseAmount = 0;
      let decreaseAmount = 0;
      for (const line of stockCount.lines) {
        const value = await this.inventory.recordAdjustment(
          tx,
          {
            tenantId,
            companyId: stockCount.companyId,
            warehouseId: stockCount.warehouseId,
            productId: line.productId,
            sourceModule: 'INVENTORY',
            sourceDocType: 'stock_count',
            sourceDocId: stockCount.id,
            moveDate: stockCount.countDate,
          },
          Number(line.systemQuantity),
          Number(line.countedQuantity),
        );
        if (value > 0) increaseAmount += value;
        else decreaseAmount += -value;
      }

      let journalEntryId: string | undefined;
      if (increaseAmount > 0 || decreaseAmount > 0) {
        const company = await tx.company.findUniqueOrThrow({ where: { id: stockCount.companyId } });
        const entry = await this.engine.postEvent(tx, {
          tenantId,
          companyId: stockCount.companyId,
          eventType: 'INVENTORY_ADJUSTMENT_POSTED',
          entryDate: stockCount.countDate,
          currencyCode: company.baseCurrencyCode,
          sourceModule: 'INVENTORY',
          sourceDocType: 'stock_count',
          sourceDocId: stockCount.id,
          description: `Stock Count ${stockCount.countNumber}`,
          amounts: { increaseAmount, decreaseAmount },
          createdBy: userId,
        });
        journalEntryId = entry.id;
      }

      const posted = await tx.stockCount.update({ where: { id }, data: { status: 'posted' } });
      await this.audit.record(tx, {
        tenantId,
        companyId: stockCount.companyId,
        userId,
        action: 'post',
        entityType: 'stock_count',
        entityId: id,
        newValue: { journalEntryId, increaseAmount, decreaseAmount },
      });
      return posted;
    });
  }
}

@Controller('stock-counts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('inventory.manage')
export class StockCountsController {
  constructor(private readonly stockCounts: StockCountsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.stockCounts.list(user.tenantId, companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStockCountDto) {
    return this.stockCounts.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.stockCounts.post(user.tenantId, user.userId, id);
  }
}
