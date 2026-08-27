import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * The connection every normal request uses. It authenticates as
 * omnierp_app — a role with no BYPASSRLS attribute and no table ownership —
 * so every Row-Level Security policy in
 * prisma/migrations/*_rls_and_guards/migration.sql actually applies to it.
 *
 * All tenant-scoped work must go through `run()`, which opens one Postgres
 * transaction, sets `app.tenant_id` for that transaction only (SET LOCAL,
 * via the parameterized set_config() function so the value is never
 * string-interpolated into SQL), and only then executes the callback. Because
 * the setting is transaction-local, it cannot leak onto a later request that
 * reuses the same pooled connection.
 */
@Injectable()
export class TenantPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: { url: process.env.APP_DATABASE_URL },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Run `fn` inside a transaction scoped to `tenantId`. Every query issued
   * through the passed transaction client is filtered by Postgres RLS to
   * rows belonging to that tenant — a query that forgets a `WHERE tenant_id`
   * clause still cannot return or mutate another tenant's rows.
   */
  async run<T>(
    tenantId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }
}
