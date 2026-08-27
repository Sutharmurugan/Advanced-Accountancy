import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 11 exit criterion (roadmap section J): "A multi-currency,
 * two-company group produces a consolidated P&L/BS with eliminations
 * reconciling to zero."
 */
describe('Group Consolidation (Phase 11 exit criterion)', () => {
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

  const api = () => request(app.getHttpServer());

  it('translates two companies\' books to a presentation currency and blocks finalization until intercompany transactions are matched', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'abcgroup',
        tenantSlug: 'abcgroup',
        adminEmail: 'owner@abcgroup.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const group = await auth(api().post('/api/v1/business-groups')).send({ name: 'ABC Group' });
    const businessGroupId = group.body.id as string;

    const sg = await auth(api().post('/api/v1/companies')).send({
      businessGroupId,
      name: 'ABC Singapore',
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const my = await auth(api().post('/api/v1/companies')).send({
      businessGroupId,
      name: 'ABC Malaysia',
      countryCode: 'MY',
      baseCurrencyCode: 'MYR',
    });

    // 1 MYR = 0.30 SGD.
    await auth(api().post('/api/v1/exchange-rates')).send({
      companyId: my.body.id,
      fromCurrency: 'MYR',
      toCurrency: 'SGD',
      rate: 0.3,
      rateDate: '2026-01-31',
    });

    const sgCoa = await auth(api().get(`/api/v1/chart-of-accounts?companyId=${sg.body.id}`));
    const sgAr = sgCoa.body.find((a: any) => a.accountCode === '1100');
    const sgRevenue = sgCoa.body.find((a: any) => a.accountCode === '4000');
    const myCoa = await auth(api().get(`/api/v1/chart-of-accounts?companyId=${my.body.id}`));
    const myAr = myCoa.body.find((a: any) => a.accountCode === '1100');
    const myRevenue = myCoa.body.find((a: any) => a.accountCode === '4000');

    // Give Singapore an Intercompany Receivable account to eliminate against.
    const sgIntercompanyAccount = await auth(api().post('/api/v1/chart-of-accounts')).send({
      companyId: sg.body.id,
      accountCode: '1150',
      name: 'Intercompany Receivable',
      accountType: 'asset',
      controlType: 'INTERCOMPANY',
    });

    async function postManualJe(companyId: string, lines: any[]) {
      const je = await auth(api().post('/api/v1/journal-entries')).send({
        companyId,
        entryDate: '2026-01-15',
        currencyCode: companyId === sg.body.id ? 'SGD' : 'MYR',
        lines,
      });
      await auth(api().post(`/api/v1/journal-entries/${je.body.id}/submit`)).expect(201);
      await auth(api().post(`/api/v1/journal-entries/${je.body.id}/approve`)).expect(201);
      await auth(api().post(`/api/v1/journal-entries/${je.body.id}/post`)).expect(201);
      return je.body.id;
    }

    const sgJeId = await postManualJe(sg.body.id, [
      { accountId: sgAr.id, debit: 1000 },
      { accountId: sgRevenue.id, credit: 1000 },
    ]);
    const myJeId = await postManualJe(my.body.id, [
      { accountId: myAr.id, debit: 2000 },
      { accountId: myRevenue.id, credit: 2000 },
    ]);
    // Singapore's intercompany trade with Malaysia: 500 SGD booked to the
    // Intercompany Receivable account.
    await postManualJe(sg.body.id, [
      { accountId: sgIntercompanyAccount.body.id, debit: 500 },
      { accountId: sgRevenue.id, credit: 500 },
    ]);

    const run = await auth(api().post('/api/v1/consolidation-runs')).send({
      businessGroupId,
      periodLabel: '2026-01',
      presentationCurrency: 'SGD',
      asOfDate: '2026-01-31',
    });
    expect(run.status).toBe(201);
    const runId = run.body.id;

    let summary = await auth(api().get(`/api/v1/consolidation-runs/${runId}/summary`)).expect(200);
    const consolidatedAr = summary.body.find((r: any) => r.accountCode === '1100');
    // SG AR (1000 SGD) + MY AR translated (2000 * 0.3 = 600 SGD) = 1600.
    expect(consolidatedAr.total).toBe(1600);
    const consolidatedIntercompany = summary.body.find((r: any) => r.accountCode === '1150');
    expect(consolidatedIntercompany.total).toBe(500); // not yet eliminated

    const intercompanyTxn = await auth(api().post('/api/v1/intercompany-transactions')).send({
      businessGroupId,
      companyAId: sg.body.id,
      companyBId: my.body.id,
      companyAEntryId: sgJeId,
      amount: 500,
      currencyCode: 'SGD',
    });

    // Finalizing must be blocked while the transaction is unmatched.
    await auth(api().post(`/api/v1/consolidation-runs/${runId}/finalize`)).expect(400);

    await auth(
      api().post(`/api/v1/intercompany-transactions/${intercompanyTxn.body.id}/match`),
    ).send({ companyBEntryId: myJeId }).expect(201);

    // The intercompany transaction is now matched, so re-running
    // consolidation applies the elimination to the Intercompany Receivable
    // account, and finalize is no longer blocked.
    const run2 = await auth(api().post('/api/v1/consolidation-runs')).send({
      businessGroupId,
      periodLabel: '2026-01',
      presentationCurrency: 'SGD',
      asOfDate: '2026-01-31',
    });
    summary = await auth(api().get(`/api/v1/consolidation-runs/${run2.body.id}/summary`)).expect(200);
    const eliminatedIntercompany = summary.body.find((r: any) => r.accountCode === '1150');
    expect(eliminatedIntercompany.total).toBe(0); // 500 - 500 eliminated

    const finalized = await auth(
      api().post(`/api/v1/consolidation-runs/${run2.body.id}/finalize`),
    ).expect(201);
    expect(finalized.body.status).toBe('final');
  });
});
