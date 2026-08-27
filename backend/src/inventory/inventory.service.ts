import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export interface StockMoveContext {
  tenantId: string;
  companyId: string;
  warehouseId: string;
  productId: string;
  sourceModule: string;
  sourceDocType: string;
  sourceDocId: string;
  moveDate: Date;
}

/**
 * The unified inventory ledger (section 8 / the "stock_moves is the
 * inventory analogue of journal_entries" note in the architecture doc).
 * Every physical movement is one stock_moves row; stock_balances is the
 * incrementally maintained weighted-average valuation summary, kept in
 * step the same way gl_account_balances is for the accounting engine.
 *
 * Valuation method: weighted average cost. A stock-in blends the new
 * cost into the running average; a stock-out and a negative adjustment
 * both value at the *current* average (never at the incoming line's own
 * cost) since they're removing from an already-blended pool.
 */
@Injectable()
export class InventoryService {
  /** Increases on-hand quantity and blends unitCost into the running
   * weighted average. Returns the resulting average cost. */
  async recordStockIn(
    tx: Prisma.TransactionClient,
    ctx: StockMoveContext,
    quantity: number,
    unitCost: number,
  ): Promise<number> {
    if (quantity <= 0) throw new BadRequestException('Stock-in quantity must be positive');

    await tx.stockMove.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        warehouseId: ctx.warehouseId,
        productId: ctx.productId,
        moveType: 'in',
        quantity,
        unitCost,
        sourceModule: ctx.sourceModule,
        sourceDocType: ctx.sourceDocType,
        sourceDocId: ctx.sourceDocId,
        moveDate: ctx.moveDate,
      },
    });

    const existing = await tx.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: ctx.warehouseId, productId: ctx.productId } },
    });
    const oldQty = existing ? Number(existing.quantityOnHand) : 0;
    const oldAvgCost = existing ? Number(existing.averageCost) : 0;
    const newQty = oldQty + quantity;
    const newAvgCost = newQty > 0 ? (oldQty * oldAvgCost + quantity * unitCost) / newQty : 0;

    await tx.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId: ctx.warehouseId, productId: ctx.productId } },
      create: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        warehouseId: ctx.warehouseId,
        productId: ctx.productId,
        quantityOnHand: newQty,
        averageCost: newAvgCost,
      },
      update: { quantityOnHand: newQty, averageCost: newAvgCost },
    });

    return newAvgCost;
  }

  /** Decreases on-hand quantity, valued at the current weighted-average
   * cost. Returns { unitCost, totalCost } for the caller to post COGS with. */
  async recordStockOut(
    tx: Prisma.TransactionClient,
    ctx: StockMoveContext,
    quantity: number,
  ): Promise<{ unitCost: number; totalCost: number }> {
    if (quantity <= 0) throw new BadRequestException('Stock-out quantity must be positive');

    const balance = await tx.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: ctx.warehouseId, productId: ctx.productId } },
    });
    const avgCost = balance ? Number(balance.averageCost) : 0;
    const onHand = balance ? Number(balance.quantityOnHand) : 0;
    if (onHand < quantity) {
      throw new BadRequestException(
        `Insufficient stock: ${quantity} requested, ${onHand} on hand`,
      );
    }

    await tx.stockMove.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        warehouseId: ctx.warehouseId,
        productId: ctx.productId,
        moveType: 'out',
        quantity: -quantity,
        unitCost: avgCost,
        sourceModule: ctx.sourceModule,
        sourceDocType: ctx.sourceDocType,
        sourceDocId: ctx.sourceDocId,
        moveDate: ctx.moveDate,
      },
    });

    await tx.stockBalance.update({
      where: { warehouseId_productId: { warehouseId: ctx.warehouseId, productId: ctx.productId } },
      data: { quantityOnHand: onHand - quantity },
    });

    return { unitCost: avgCost, totalCost: avgCost * quantity };
  }

  /** Applies a stock-count variance (countedQuantity - systemQuantity).
   * Returns the signed value of the adjustment at current average cost,
   * for INVENTORY_ADJUSTMENT_POSTED (positive = stock found, negative =
   * stock missing). Average cost is left unchanged either way. */
  async recordAdjustment(
    tx: Prisma.TransactionClient,
    ctx: StockMoveContext,
    systemQuantity: number,
    countedQuantity: number,
  ): Promise<number> {
    const delta = countedQuantity - systemQuantity;
    if (delta === 0) return 0;

    const balance = await tx.stockBalance.findUnique({
      where: { warehouseId_productId: { warehouseId: ctx.warehouseId, productId: ctx.productId } },
    });
    const avgCost = balance ? Number(balance.averageCost) : 0;
    const onHand = balance ? Number(balance.quantityOnHand) : 0;

    await tx.stockMove.create({
      data: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        warehouseId: ctx.warehouseId,
        productId: ctx.productId,
        moveType: 'adjustment',
        quantity: delta,
        unitCost: avgCost,
        sourceModule: ctx.sourceModule,
        sourceDocType: ctx.sourceDocType,
        sourceDocId: ctx.sourceDocId,
        moveDate: ctx.moveDate,
      },
    });

    await tx.stockBalance.upsert({
      where: { warehouseId_productId: { warehouseId: ctx.warehouseId, productId: ctx.productId } },
      create: {
        tenantId: ctx.tenantId,
        companyId: ctx.companyId,
        warehouseId: ctx.warehouseId,
        productId: ctx.productId,
        quantityOnHand: countedQuantity,
        averageCost: avgCost,
      },
      update: { quantityOnHand: onHand + delta },
    });

    return delta * avgCost;
  }
}
