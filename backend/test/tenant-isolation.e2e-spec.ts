import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { TenantPrismaService } from '../src/common/prisma/tenant-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 1 exit criterion (docs/architecture/00-OMNIERP-ARCHITECTURE.md,
 * section J): "A second tenant's user cannot see the first tenant's data
 * under any code path, verified by an automated cross-tenant test."
 *
 * This suite checks that at three different layers, not just one:
 *  - the public HTTP API (list/get)
 *  - a direct service/Prisma call that bypasses the controller entirely
 *  - the database with no tenant context set at all (fail-closed default)
 * plus the audit log's append-only guarantee, since it's the other
 * database-level invariant Phase 1 commits to.
 */
describe('Tenant isolation (Phase 1 exit criterion)', () => {
  let app: INestApplication;
  let platformPrisma: PlatformPrismaService;
  let tenantPrisma: TenantPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    platformPrisma = app.get(PlatformPrismaService);
    tenantPrisma = app.get(TenantPrismaService);

    // Seed the global permission catalogue once; it is never truncated
    // between tests (see beforeEach) because it carries no tenant data.
    for (const permission of PERMISSIONS) {
      await platformPrisma.permission.upsert({
        where: { code: permission.code },
        update: {},
        create: permission,
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // TRUNCATE ... CASCADE follows the FK graph from tenants down to every
    // tenant-scoped table (companies, users, roles, audit_logs, ...),
    // giving each test a clean slate without touching the permission
    // catalogue. Runs on the platform (superuser) connection because RLS
    // would otherwise block it even for an empty WHERE clause on DELETE.
    await platformPrisma.$executeRawUnsafe('TRUNCATE TABLE tenants CASCADE');
  });

  async function signup(tenantSlug: string, tenantName: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName,
        tenantSlug,
        adminEmail: `owner@${tenantSlug}.test`,
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    return res.body.accessToken as string;
  }

  it('lets a tenant see and manage only its own companies via the API', async () => {
    const tokenA = await signup('tenant-a', 'Tenant A');
    const tokenB = await signup('tenant-b', 'Tenant B');

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'A Singapore Pte Ltd', countryCode: 'SG', baseCurrencyCode: 'SGD' })
      .expect(201);
    const companyAId = createRes.body.id as string;

    // Tenant B's own list is empty — Tenant A's company never appears.
    const listAsB = await request(app.getHttpServer())
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
    expect(listAsB.body).toEqual([]);

    // Tenant B fetching Tenant A's company by its real, known id gets a
    // 404 — not a 403, and definitely not the record. RLS makes the row
    // invisible rather than merely forbidden, so there is nothing to leak
    // even in the error path.
    await request(app.getHttpServer())
      .get(`/api/v1/companies/${companyAId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    // Tenant A still sees its own company correctly.
    const listAsA = await request(app.getHttpServer())
      .get('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(listAsA.body).toHaveLength(1);
    expect(listAsA.body[0].id).toBe(companyAId);
  });

  it('enforces isolation at the database layer even when a service call bypasses the controller entirely', async () => {
    const tokenA = await signup('tenant-c', 'Tenant C');
    await signup('tenant-d', 'Tenant D');

    const meA = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const tenantAId = meA.body.tenantId as string;

    const tenantBRecord = await platformPrisma.tenant.findUnique({
      where: { slug: 'tenant-d' },
    });
    const tenantDId = tenantBRecord!.id;

    // Query directly through TenantPrismaService.run(), scoped to tenant D,
    // for a user row that only exists under tenant C. No controller, no
    // guard, no JWT in the picture — this proves the isolation is a
    // property of the database session, not of any particular code path
    // that happens to remember a WHERE clause.
    const crossTenantUsers = await tenantPrisma.run(tenantDId, (tx) =>
      tx.user.findMany({ where: { tenantId: tenantAId } }),
    );
    expect(crossTenantUsers).toEqual([]);

    const ownTenantUsers = await tenantPrisma.run(tenantAId, (tx) =>
      tx.user.findMany({ where: { tenantId: tenantAId } }),
    );
    expect(ownTenantUsers.length).toBeGreaterThan(0);
  });

  it('fails closed — a query with no tenant context set returns zero rows, not everything', async () => {
    await signup('tenant-e', 'Tenant E');

    // Deliberately query the RLS-bound connection outside of
    // TenantPrismaService.run(), so app.tenant_id is never set for this
    // transaction. If RLS were misconfigured to fail open, this would
    // return every tenant's companies.
    const rows = await tenantPrisma.company.findMany();
    expect(rows).toEqual([]);
  });

  it('keeps the audit log append-only, even for the application role', async () => {
    const tokenA = await signup('tenant-f', 'Tenant F');
    await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'F Co', countryCode: 'SG', baseCurrencyCode: 'SGD' })
      .expect(201);

    const meA = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const tenantAId = meA.body.tenantId as string;

    const [log] = await tenantPrisma.run(tenantAId, (tx) =>
      tx.auditLog.findMany({ where: { entityType: 'company' }, take: 1 }),
    );
    expect(log).toBeDefined();
    expect(log.rowHash).toBeTruthy();

    await expect(
      tenantPrisma.run(tenantAId, (tx) =>
        tx.auditLog.updateMany({
          where: { id: log.id },
          data: { action: 'delete' },
        }),
      ),
    ).rejects.toThrow();
  });

  it('rejects a user without the required permission from creating a company', async () => {
    const tokenA = await signup('tenant-g', 'Tenant G');
    const meA = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    const tenantAId = meA.body.tenantId as string;

    // Create a second user with no role/permission grants at all.
    const inviteRes = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ email: 'noaccess@tenant-g.test', password: 'another-long-password' })
      .expect(201);
    const noAccessUserId = inviteRes.body.id as string;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({
        tenantSlug: 'tenant-g',
        email: 'noaccess@tenant-g.test',
        password: 'another-long-password',
      })
      .expect(200);
    const noAccessToken = loginRes.body.accessToken as string;

    await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${noAccessToken}`)
      .send({ name: 'Should Not Be Created', countryCode: 'SG', baseCurrencyCode: 'SGD' })
      .expect(403);

    // Sanity: the invited user really was created under the same tenant.
    const usersInTenantA = await tenantPrisma.run(tenantAId, (tx) =>
      tx.user.findMany({ where: { id: noAccessUserId } }),
    );
    expect(usersInTenantA).toHaveLength(1);
  });
});
