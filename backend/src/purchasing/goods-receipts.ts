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
import { InventoryService } from '../inventory/inventory.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class GoodsReceiptLineDto {
  @IsString() productId: string;
  @IsNumber() quantity: number;
  @IsNumber() unitCost: number;
}

export class CreateGoodsReceiptDto {
  @IsString() companyId: string;
  @IsOptional() @IsString() purchaseOrderId?: string;
  @IsString() warehouseId: string;
  @IsDateString() receiptDate: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GoodsReceiptLineDto)
  lines: GoodsReceiptLineDto[];
}

/**
 * Goods Receipt increases stock quantity/valuation (wired in
 * src/inventory/goods-receipt-posting.service.ts, Phase 6) but does not
 * post to the GL on its own — the inventory value is recognized when the
 * matching Supplier Invoice posts (debiting Inventory instead of a generic
 * expense account for inventory-tracked lines). This is a deliberate
 * simplification: no GR/IR clearing account, on the assumption receipt and
 * invoice arrive close together for the SME/single-step-procurement case
 * this system targets. See backend/README.md.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly inventory: InventoryService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.goodsReceipt.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const receipt = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.goodsReceipt.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!receipt) throw new NotFoundException('Goods receipt not found');
    return receipt;
  }

  create(tenantId: string, userId: string, dto: CreateGoodsReceiptDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const receiptNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'GOODS_RECEIPT',
        'GRN-',
      );
      const receipt = await tx.goodsReceipt.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          purchaseOrderId: dto.purchaseOrderId,
          warehouseId: dto.warehouseId,
          receiptNumber,
          receiptDate: new Date(dto.receiptDate),
          lines: {
            create: dto.lines.map((l, idx) => ({
              lineNo: idx + 1,
              productId: l.productId,
              quantity: l.quantity,
              unitCost: l.unitCost,
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
        entityType: 'goods_receipt',
        entityId: receipt.id,
        newValue: { receiptNumber },
      });
      return receipt;
    });
  }

  /**
   * Increases stock quantity/valuation for each line via InventoryService.
   * Deliberately posts no GL entry — see the module-level comment above:
   * inventory value is recognized on the GL when the matching Supplier
   * Invoice posts, not here.
   */
  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const receipt = await tx.goodsReceipt.findUnique({ where: { id }, include: { lines: true } });
      if (!receipt) throw new NotFoundException('Goods receipt not found');
      if (receipt.status !== 'draft') {
        throw new BadRequestException('Only a draft goods receipt can be posted');
      }

      for (const line of receipt.lines) {
        await this.inventory.recordStockIn(
          tx,
          {
            tenantId,
            companyId: receipt.companyId,
            warehouseId: receipt.warehouseId,
            productId: line.productId,
            sourceModule: 'PURCHASING',
            sourceDocType: 'goods_receipt',
            sourceDocId: receipt.id,
            moveDate: receipt.receiptDate,
          },
          Number(line.quantity),
          Number(line.unitCost),
        );
      }

      const posted = await tx.goodsReceipt.update({ where: { id }, data: { status: 'posted' } });
      await this.audit.record(tx, {
        tenantId,
        companyId: receipt.companyId,
        userId,
        action: 'post',
        entityType: 'goods_receipt',
        entityId: id,
      });
      return posted;
    });
  }
}

@Controller('goods-receipts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('purchasing.manage')
export class GoodsReceiptsController {
  constructor(private readonly goodsReceipts: GoodsReceiptsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.goodsReceipts.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.goodsReceipts.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateGoodsReceiptDto) {
    return this.goodsReceipts.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.goodsReceipts.post(user.tenantId, user.userId, id);
  }
}
