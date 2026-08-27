import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 9 exit criterion (roadmap section J): "Depreciation schedules post
 * automatically per period; budget vs actual variance reports work."
 */
describe('Fixed Assets & Budgeting (Phase 9 exit criterion)', () => {
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

  it('generates a straight-line depreciation schedule and posts due periods automatically', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'assetco',
        tenantSlug: 'assetco',
        adminEmail: 'owner@assetco.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: 'Assetco',
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const companyId = company.body.id as string;

    const coa = await auth(api().get(`/api/v1/chart-of-accounts?companyId=${companyId}`));
    const cash = coa.body.find((a: any) => a.accountCode === '1900');
    const depreciationExpense = coa.body.find((a: any) => a.accountCode === '6100');
    const accumulatedDepreciation = coa.body.find((a: any) => a.accountCode === '1500');

    const asset = await auth(api().post('/api/v1/fixed-assets')).send({
      companyId,
      assetCode: 'AST-1',
      name: 'Delivery Van',
      acquisitionDate: '2026-01-01',
      acquisitionCost: 12000,
      usefulLifeMonths: 12,
      residualValue: 0,
      assetAccountId: cash.id,
      depreciationExpenseAccountId: depreciationExpense.id,
      accumulatedDepreciationAccountId: accumulatedDepreciation.id,
    });
    expect(asset.status).toBe(201);
    expect(asset.body.depreciationSchedules).toHaveLength(12);
    expect(Number(asset.body.depreciationSchedules[0].amount)).toBe(1000);

    // Run depreciation as of end of March — should post Jan, Feb, Mar (3
    // periods), leaving the rest pending.
    const run = await auth(api().post('/api/v1/fixed-assets/run-depreciation')).send({
      companyId,
      asOfDate: '2026-03-31',
    });
    expect(run.status).toBe(201);
    expect(run.body).toHaveLength(3);
    expect(run.body.every((s: any) => s.status === 'posted')).toBe(true);

    const tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-03-31`),
    );
    const expenseRow = tb.body.find((r: any) => r.accountCode === '6100');
    const accumRow = tb.body.find((r: any) => r.accountCode === '1500');
    expect(expenseRow.balance).toBe(3000);
    expect(accumRow.balance).toBe(-3000);

    // Running again immediately for the same cutoff has nothing left to do.
    await auth(api().post('/api/v1/fixed-assets/run-depreciation')).send({
      companyId,
      asOfDate: '2026-03-31',
    }).expect(400);
  });

  it('computes budget vs. actual variance from posted journal entries', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'budgetco',
        tenantSlug: 'budgetco',
        adminEmail: 'owner@budgetco.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: 'Budgetco',
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const companyId = company.body.id as string;

    const coa = await auth(api().get(`/api/v1/chart-of-accounts?companyId=${companyId}`));
    const ar = coa.body.find((a: any) => a.accountCode === '1100');
    const revenue = coa.body.find((a: any) => a.accountCode === '4000');

    const fiscalYears = await auth(api().get(`/api/v1/fiscal-years?companyId=${companyId}`));
    const fiscalYearId = fiscalYears.body[0].id;

    const budget = await auth(api().post('/api/v1/budgets')).send({
      companyId,
      name: 'FY2026 Budget',
      fiscalYearId,
      lines: [{ accountId: revenue.id, periodNo: 1, amount: -5000 }], // budgeted revenue (credit-natural, negative in debit-credit terms)
    });

    // Post an actual manual entry recognizing 4000 of revenue in January.
    const je = await auth(api().post('/api/v1/journal-entries')).send({
      companyId,
      entryDate: '2026-01-15',
      currencyCode: 'SGD',
      lines: [
        { accountId: ar.id, debit: 4000 },
        { accountId: revenue.id, credit: 4000 },
      ],
    });
    await auth(api().post(`/api/v1/journal-entries/${je.body.id}/submit`)).expect(201);
    await auth(api().post(`/api/v1/journal-entries/${je.body.id}/approve`)).expect(201);
    await auth(api().post(`/api/v1/journal-entries/${je.body.id}/post`)).expect(201);

    const variance = await auth(api().get(`/api/v1/budgets/${budget.body.id}/variance`)).expect(200);
    const revenueLine = variance.body.find((v: any) => v.accountCode === '4000');
    expect(revenueLine.budgeted).toBe(-5000);
    expect(revenueLine.actual).toBe(-4000);
    expect(revenueLine.variance).toBe(1000); // under-budgeted revenue by 1000 (less negative than budget)
  });
});
