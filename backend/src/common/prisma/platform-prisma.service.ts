import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connects with the migration/owner credentials (DATABASE_URL), which in
 * Postgres means a superuser connection that bypasses Row-Level Security
 * regardless of the FORCE ROW LEVEL SECURITY setting on tenant tables.
 *
 * This client must be used for exactly two things:
 *  - creating a brand new tenant during signup (there is no tenant context
 *    to SET LOCAL yet, because the tenant doesn't exist)
 *  - resolving a tenant's id from its slug during login (the client only
 *    knows the slug, not the id, before authentication)
 *
 * Every other query in the application goes through TenantPrismaService,
 * which is bound by Row-Level Security. Do not widen this client's usage.
 */
@Injectable()
export class PlatformPrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      datasources: {
        db: { url: process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
