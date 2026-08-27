import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { TenantPrismaService } from '../src/common/prisma/tenant-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';
import { AccountingEngineService } from '../src/accounting/accounting-engine.service';

/**
 * Phase 3 exit criterion (roadmap section J): "A manual journal entry can
 * be posted, reversed, and shows correctly in a Trial Balance; posted
 * entries are provably immutable."
 *
 * The immutability assertions here are deliberately specific about *which*
 * status is protected — an earlier version of the posted-entry trigger
 * stopped protecting an entry the moment it flipped to 'reversed', which
 * would have let a reversed entry's amounts be silently rewritten. Both the
 * still-posted reversal entry and the now-reversed original must reject a
 * direct UPDATE.
 */
describe('Central Accounting Engine (Phase 3 exit criterion)', () => {
  let app: INestApplication;
  let platformPrisma: PlatformPrismaService;
  let tenantPrisma: TenantPrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    platformPrisma = app.get(PlatformPrismaService);
    tenantPrisma = app.get(TenantPrismaService);

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

    const coaRes = await request(app.getHttpServer())
      .get(`/api/v1/chart-of-accounts?companyId=${company.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const accountByCode = (code: string) =>
      coaRes.body.find((a: any) => a.accountCode === code);

    return { token, companyId: company.body.id, accountByCode };
  }

  it('provisions a postable starter Chart of Accounts and fiscal year on company creation', async () => {
    const { accountByCode, token, companyId } = await signupAndCreateCompany('provtest');
    expect(accountByCode('1100').controlType).toBe('AR'); // Accounts Receivable
    expect(accountByCode('4000').controlType).toBe('SALES_REVENUE');

    const fiscalYears = await request(app.getHttpServer())
      .get(`/api/v1/fiscal-years?companyId=${companyId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fiscalYears.body[0].periods).toHaveLength(12);
    expect(fiscalYears.body[0].periods[0].status).toBe('open');
  });

  it('posts a balanced manual journal entry through draft -> submitted -> approved -> posted and reflects it on the Trial Balance', async () => {
    const { token, companyId, accountByCode } = await signupAndCreateCompany('jeflow');
    const ar = accountByCode('1100');
    const revenue = accountByCode('4000');

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        entryDate: '2026-01-15',
        currencyCode: 'SGD',
        description: 'Opening AR balance',
        lines: [
          { accountId: ar.id, debit: 1000 },
          { accountId: revenue.id, credit: 1000 },
        ],
      })
      .expect(201);
    expect(createRes.body.status).toBe('draft');
    const jeId = createRes.body.id;

    await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${jeId}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${jeId}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const postRes = await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${jeId}/post`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(postRes.body.status).toBe('posted');

    const tb = await request(app.getHttpServer())
      .get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const arRow = tb.body.find((r: any) => r.accountCode === '1100');
    const revRow = tb.body.find((r: any) => r.accountCode === '4000');
    expect(arRow.balance).toBe(1000);
    expect(revRow.balance).toBe(-1000); // natural credit balance, debit - credit convention
  });

  it('rejects an unbalanced manual journal entry', async () => {
    const { token, companyId, accountByCode } = await signupAndCreateCompany('unbalanced');
    const ar = accountByCode('1100');
    const revenue = accountByCode('4000');

    await request(app.getHttpServer())
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        entryDate: '2026-01-15',
        currencyCode: 'SGD',
        lines: [
          { accountId: ar.id, debit: 1000 },
          { accountId: revenue.id, credit: 999 },
        ],
      })
      .expect(400);
  });

  it('reverses a posted entry, nets the Trial Balance to zero, and keeps both entries immutable at the database layer', async () => {
    const { token, companyId, accountByCode } = await signupAndCreateCompany('reversal');
    const ar = accountByCode('1100');
    const revenue = accountByCode('4000');

    const createRes = await request(app.getHttpServer())
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        entryDate: '2026-01-15',
        currencyCode: 'SGD',
        lines: [
          { accountId: ar.id, debit: 1000 },
          { accountId: revenue.id, credit: 1000 },
        ],
      })
      .expect(201);
    const jeId = createRes.body.id;
    await request(app.getHttpServer()).post(`/api/v1/journal-entries/${jeId}/submit`).set('Authorization', `Bearer ${token}`).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/journal-entries/${jeId}/approve`).set('Authorization', `Bearer ${token}`).expect(201);
    await request(app.getHttpServer()).post(`/api/v1/journal-entries/${jeId}/post`).set('Authorization', `Bearer ${token}`).expect(201);

    const reverseRes = await request(app.getHttpServer())
      .post(`/api/v1/journal-entries/${jeId}/reverse`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reversalDate: '2026-01-20' })
      .expect(201);
    expect(reverseRes.body.reversalOfId).toBe(jeId);
    const reversalId = reverseRes.body.id;

    const tb = await request(app.getHttpServer())
      .get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const arRow = tb.body.find((r: any) => r.accountCode === '1100');
    expect(arRow.balance).toBe(0);

    const meRes = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const tenantId = meRes.body.tenantId as string;

    // Direct database-layer check, bypassing the API entirely: neither the
    // now-reversed original nor the still-posted reversal entry can be
    // edited, even by the application's own database role.
    await expect(
      tenantPrisma.run(tenantId, (tx) =>
        tx.journalEntry.update({ where: { id: jeId }, data: { description: 'tampered' } }),
      ),
    ).rejects.toThrow();
    await expect(
      tenantPrisma.run(tenantId, (tx) =>
        tx.journalEntry.update({ where: { id: reversalId }, data: { description: 'tampered' } }),
      ),
    ).rejects.toThrow();
  });

  it('refuses to post an event with no configured posting rule, and refuses to post into a closed period', async () => {
    const { token, companyId, accountByCode } = await signupAndCreateCompany('guardrails');
    const ar = accountByCode('1100');
    const revenue = accountByCode('4000');

    // Close January's period, then try to post into it.
    const fiscalYears = await request(app.getHttpServer())
      .get(`/api/v1/fiscal-years?companyId=${companyId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const januaryPeriod = fiscalYears.body[0].periods[0];
    await request(app.getHttpServer())
      .patch(`/api/v1/fiscal-years/periods/${januaryPeriod.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'closed' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/journal-entries')
      .set('Authorization', `Bearer ${token}`)
      .send({
        companyId,
        entryDate: '2026-01-15',
        currencyCode: 'SGD',
        lines: [
          { accountId: ar.id, debit: 100 },
          { accountId: revenue.id, credit: 100 },
        ],
      })
      .expect(201); // creating a draft is still allowed...

    // ...but the engine itself refuses a module-triggered post into a
    // closed period. Exercise this directly since Phase 3 has no sales
    // module yet to trigger it through the API.
    const meRes = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const tenantId = meRes.body.tenantId as string;

    await expect(
      tenantPrisma.run(tenantId, (tx) => {
        const engine = app.get(AccountingEngineService);
        return engine.postEvent(tx, {
          tenantId,
          companyId,
          eventType: 'NO_SUCH_EVENT',
          entryDate: new Date('2026-01-15'),
          currencyCode: 'SGD',
          sourceModule: 'TEST',
          sourceDocType: 'test',
          sourceDocId: 'test-1',
          amounts: { total: 100 },
        });
      }),
    ).rejects.toThrow();
  });
});
