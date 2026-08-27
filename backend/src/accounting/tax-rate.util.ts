import { Prisma } from '@prisma/client';

/** Resolves the tax rate percentage in effect for a tax code on a given
 * date — the most recent rate whose effectiveFrom is on or before the date
 * and whose effectiveTo (if any) is on or after it. Returns 0 for no tax
 * code (a zero-rated/untaxed line). */
export async function currentTaxRatePercent(
  tx: Prisma.TransactionClient,
  taxCodeId: string | undefined | null,
  asOfDate: Date,
): Promise<number> {
  if (!taxCodeId) return 0;
  const rate = await tx.taxRate.findFirst({
    where: {
      taxCodeId,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
  return rate ? Number(rate.ratePercent) : 0;
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
