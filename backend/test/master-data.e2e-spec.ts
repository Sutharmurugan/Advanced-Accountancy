import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 2 exit criterion (roadmap section J): "Master data CRUD works per
 * company with full scoping and audit logging."
 */
describe('Master data (Phase 2 exit criterion)', () => {
  let app: INestApplication;
  let platformPrisma: PlatformPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
    platformPrisma = app.get(PlatformPrismaService);

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
    await platformPrisma.$executeRawUnsafe('TRUNCATE TABLE tenants CASCADE');
  });

  async function signupAndCreateCompany(slug: string) {
    const signup = await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({
        tenantName: slug,
        tenantSlug: slug,
        adminEmail: `owner@${slug}.test`,
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const company = await request(app.getHttpServer())
      .post('/api/v1/companies')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `${slug} Co`, countryCode: 'SG', baseCurrencyCode: 'SGD' })
      .expect(201);
    return { token, companyId: company.body.id as string };
  }

  it('creates, lists and audits a customer and a product, scoped to their own company', async () => {
    const { token, companyId } = await signupAndCreateCompany('md1');

    const uomRes = await request(app.getHttpServer())
      .post('/api/v1/uoms')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, code: 'EA', name: 'Each' })
      .expect(201);

    const customerRes = await request(app.getHttpServer())
      .post('/api/v1/customers')
      .set('Authorization', `Bearer ${token}`)
      .send({ companyId, code: 'CUST-001', name: 'Test Retail Pte Ltd', creditLimit: 5000 })
      .expect(201);
    expect(customerRes.body.creditLimit).toBe('5000');

    const productRes = await request(app.getHttpServer())
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        sku: 'SKU-001',
        name: 'Widget',
        uomId: uomRes.body.id,
        salesPrice: 19.9,
        purchasePrice: 9.5,
      })
      .expect(201);
    expect(productRes.body.sku).toBe('SKU-001');

    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/customers?companyId=${companyId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listRes.body).toHaveLength(1);

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const auditLogs = await platformPrisma.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM audit_logs
      WHERE tenant_id = ${meRes.body.tenantId} AND entity_type = 'customer'
    `;
    expect(Number(auditLogs[0].count)).toBeGreaterThan(0);
  });

  it('never shows one company/tenant\'s master data to another', async () => {
    const a = await signupAndCreateCompany('md-a');
    const b = await signupAndCreateCompany('md-b');

    await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${a.token}`)
      .send({ companyId: a.companyId, code: 'SUP-001', name: 'A Supplier' })
      .expect(201);

    const listAsB = await request(app.getHttpServer())
      .get(`/api/v1/suppliers?companyId=${a.companyId}`)
      .set('Authorization', `Bearer ${b.token}`)
      .expect(200);
    // Tenant B queries tenant A's own companyId, but RLS scopes by tenant
    // first — regardless of which companyId is asked for, nothing tenant
    // A owns is visible to tenant B.
    expect(listAsB.body).toEqual([]);
  });
});
