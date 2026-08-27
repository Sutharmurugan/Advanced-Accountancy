import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Atomic per-(company, docType) document numbering, shared by every module
 * that issues a human-facing document number (journal entries, invoices,
 * payroll runs, ...). Branch-level numbering is not used yet — every call
 * keys on branchId = null — so this is not a per-branch sequence.
 *
 * Locks the sequence row with SELECT ... FOR UPDATE so two concurrent
 * transactions on the same (company, docType) serialize on the increment
 * rather than racing to read the same next_number. The one gap is the very
 * first document of a given type for a company, where no row exists yet to
 * lock; a race there is accepted as a known, low-probability simplification
 * for this phase rather than adding retry-on-conflict machinery.
 */
@Injectable()
export class NumberingService {
  async next(
    tx: Prisma.TransactionClient,
    companyId: string,
    tenantId: string,
    docType: string,
    prefix = '',
  ): Promise<string> {
    const existing = await tx.$queryRaw<{ id: string; next_number: bigint }[]>`
      SELECT id, next_number FROM document_number_sequences
      WHERE company_id = ${companyId} AND branch_id IS NULL AND doc_type = ${docType}
      FOR UPDATE
    `;

    let sequenceValue: bigint;
    if (existing.length === 0) {
      sequenceValue = 1n;
      await tx.documentNumberSequence.create({
        data: { tenantId, companyId, docType, prefix, nextNumber: 2 },
      });
    } else {
      sequenceValue = existing[0].next_number;
      await tx.$executeRaw`
        UPDATE document_number_sequences SET next_number = next_number + 1
        WHERE id = ${existing[0].id}
      `;
    }

    return `${prefix}${sequenceValue.toString().padStart(6, '0')}`;
  }
}
