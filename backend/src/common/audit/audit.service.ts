import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export type AuditAction =
  | 'create'
  | 'edit'
  | 'approve'
  | 'post'
  | 'cancel'
  | 'reverse'
  | 'delete'
  | 'export'
  | 'login'
  | 'permission_change'
  | 'config_change';

export interface AuditEntry {
  tenantId: string;
  companyId?: string | null;
  userId?: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

/**
 * Writes one row to audit_logs. Always called with the same transaction
 * client (`tx`) as the business mutation it documents, so the audit record
 * and the change it describes commit or roll back together — there is no
 * window where a mutation succeeds without a trail, or a trail exists for a
 * mutation that never actually committed.
 *
 * There is deliberately no update/delete method here: the database grants
 * (see prisma/migrations/*_rls_and_guards) only allow INSERT on this table
 * for the application role, and a trigger rejects UPDATE/DELETE outright.
 */
@Injectable()
export class AuditService {
  async record(tx: Prisma.TransactionClient, entry: AuditEntry) {
    await tx.auditLog.create({
      data: {
        tenantId: entry.tenantId,
        companyId: entry.companyId ?? undefined,
        userId: entry.userId ?? undefined,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? undefined,
        oldValue: toJson(entry.oldValue),
        newValue: toJson(entry.newValue),
        ipAddress: entry.ipAddress ?? undefined,
      },
    });
  }
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value));
}
