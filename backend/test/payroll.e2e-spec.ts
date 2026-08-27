import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 8 exit criterion (roadmap section J): "A payroll run produces
 * correct payslips and journal entries via the Engine, no bespoke payroll
 * GL code."
 */
describe('HR & Payroll (Phase 8 exit criterion)', () => {
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

  it('produces correct payslips and posts one aggregate journal entry through the Accounting Engine', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'payrollco',
        tenantSlug: 'payrollco',
        adminEmail: 'owner@payrollco.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: 'Payrollco',
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const companyId = company.body.id as string;

    const empA = await auth(api().post('/api/v1/employees')).send({
      companyId,
      code: 'EMP-1',
      name: 'Alice',
    });
    const empB = await auth(api().post('/api/v1/employees')).send({
      companyId,
      code: 'EMP-2',
      name: 'Bob',
    });

    await auth(api().post('/api/v1/salary-structures')).send({
      companyId,
      employeeId: empA.body.id,
      basicSalary: 4000,
      allowances: 200,
      deductions: 400,
      effectiveFrom: '2026-01-01',
    });
    await auth(api().post('/api/v1/salary-structures')).send({
      companyId,
      employeeId: empB.body.id,
      basicSalary: 3000,
      allowances: 0,
      deductions: 300,
      effectiveFrom: '2026-01-01',
    });

    const run = await auth(api().post('/api/v1/payroll-runs')).send({
      companyId,
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
    });
    expect(run.status).toBe(201);
    expect(run.body.payslips).toHaveLength(2);
    expect(Number(run.body.totalGross)).toBe(4200 + 3000);
    expect(Number(run.body.totalDeductions)).toBe(400 + 300);
    expect(Number(run.body.totalNet)).toBe(3800 + 2700);

    await auth(api().post(`/api/v1/payroll-runs/${run.body.id}/approve`)).expect(201);
    const posted = await auth(api().post(`/api/v1/payroll-runs/${run.body.id}/post`)).expect(201);
    expect(posted.body.status).toBe('posted');
    expect(posted.body.journalEntryId).toBeTruthy();

    const tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    const salaryExpense = tb.body.find((r: any) => r.accountCode === '6000');
    const salaryPayable = tb.body.find((r: any) => r.accountCode === '2300');
    const statutoryPayable = tb.body.find((r: any) => r.accountCode === '2400');
    expect(salaryExpense.balance).toBe(7200);
    expect(salaryPayable.balance).toBe(-6500); // net pay owed, credit balance
    expect(statutoryPayable.balance).toBe(-700); // deductions withheld, credit balance
  });
});
