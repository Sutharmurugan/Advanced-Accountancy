import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 10 exit criterion (roadmap section J): "Live drill-down from Group
 * to transaction works live on real data, KPIs match manually computed
 * values."
 */
describe('MIS (Phase 10 exit criterion)', () => {
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

  it('computes dashboard KPIs matching hand-calculated values from posted transactions', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'misco',
        tenantSlug: 'misco',
        adminEmail: 'owner@misco.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: 'Misco',
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const companyId = company.body.id as string;

    const uom = await auth(api().post('/api/v1/uoms')).send({ companyId, code: 'EA', name: 'Each' });
    const product = await auth(api().post('/api/v1/products')).send({
      companyId,
      sku: 'SKU-MIS-1',
      name: 'Widget',
      uomId: uom.body.id,
    });
    const customer = await auth(api().post('/api/v1/customers')).send({
      companyId,
      code: 'CUST-1',
      name: 'Test Customer',
    });
    const warehouse = await auth(api().post('/api/v1/warehouses')).send({
      companyId,
      name: 'Main',
    });

    // Stock in 100 units at $6 cost.
    const grn = await auth(api().post('/api/v1/goods-receipts')).send({
      companyId,
      warehouseId: warehouse.body.id,
      receiptDate: '2026-01-02',
      lines: [{ productId: product.body.id, quantity: 100, unitCost: 6 }],
    });
    await auth(api().post(`/api/v1/goods-receipts/${grn.body.id}/post`)).expect(201);

    // Sell 20 units at $10 each = $200 revenue.
    const invoice = await auth(api().post('/api/v1/sales-invoices')).send({
      companyId,
      customerId: customer.body.id,
      invoiceDate: '2026-01-10',
      dueDate: '2026-02-09',
      currencyCode: 'SGD',
      lines: [{ productId: product.body.id, quantity: 20, unitPrice: 10 }],
    });
    const invoiceId = invoice.body.id;
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/submit`)).expect(201);
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/approve`)).expect(201);
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/post`)).expect(201);

    // Deliver those 20 units — COGS = 20 * 6 = $120.
    const delivery = await auth(api().post('/api/v1/deliveries')).send({
      companyId,
      warehouseId: warehouse.body.id,
      deliveryDate: '2026-01-11',
      lines: [{ productId: product.body.id, quantity: 20 }],
    });
    await auth(api().post(`/api/v1/deliveries/${delivery.body.id}/post`)).expect(201);

    const dashboard = await auth(
      api().get(
        `/api/v1/mis/dashboard?companyId=${companyId}&fromDate=2026-01-01&toDate=2026-01-31`,
      ),
    ).expect(200);

    expect(dashboard.body.revenue).toBe(200);
    expect(dashboard.body.grossProfit).toBe(80); // 200 - 120
    expect(dashboard.body.grossMarginPercent).toBe(40); // 80/200 * 100
    expect(dashboard.body.netProfit).toBe(80); // no OPEX booked
    expect(dashboard.body.receivables).toBe(200); // unpaid invoice
    // Per the documented Phase 6 simplification (backend/README.md), Goods
    // Receipt updates the stock_balances sub-ledger but posts no GL entry
    // of its own — only Delivery's COGS entry touches the Inventory
    // control account. So the GL-side Inventory balance here is just the
    // delivery's credit (20 * $6 = $120), not the sub-ledger's true
    // on-hand valuation (which /stock-balances reports correctly).
    expect(dashboard.body.inventory).toBe(-120);

    // Drill down by account within the company — the transaction-level
    // detail (General Ledger) is available for any account shown here.
    const drilldown = await auth(
      api().get(
        `/api/v1/mis/drilldown?companyId=${companyId}&fromDate=2026-01-01&toDate=2026-01-31&groupBy=accountId`,
      ),
    ).expect(200);
    expect(drilldown.body.length).toBeGreaterThan(0);
    const arAccountRow = await auth(
      api().get(`/api/v1/chart-of-accounts?companyId=${companyId}`),
    );
    const arAccount = arAccountRow.body.find((a: any) => a.accountCode === '1100');
    const drilldownAr = drilldown.body.find((d: any) => d.key === arAccount.id);
    expect(drilldownAr.balance).toBe(200);

    const gl = await auth(
      api().get(
        `/api/v1/reports/general-ledger?companyId=${companyId}&accountId=${arAccount.id}&fromDate=2026-01-01&toDate=2026-01-31`,
      ),
    ).expect(200);
    expect(gl.body).toHaveLength(1);
    expect(Number(gl.body[0].debit)).toBe(200);
  });

  it('drills down by department and compares two periods', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'misco2',
        tenantSlug: 'misco2',
        adminEmail: 'owner@misco2.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: 'Misco2',
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const companyId = company.body.id as string;
    const department = await auth(api().post('/api/v1/departments')).send({
      companyId,
      name: 'Retail',
    });

    const coa = await auth(api().get(`/api/v1/chart-of-accounts?companyId=${companyId}`));
    const ar = coa.body.find((a: any) => a.accountCode === '1100');
    const revenue = coa.body.find((a: any) => a.accountCode === '4000');

    const je = await auth(api().post('/api/v1/journal-entries')).send({
      companyId,
      entryDate: '2026-01-15',
      currencyCode: 'SGD',
      lines: [
        { accountId: ar.id, debit: 300, departmentId: department.body.id },
        { accountId: revenue.id, credit: 300, departmentId: department.body.id },
      ],
    });
    await auth(api().post(`/api/v1/journal-entries/${je.body.id}/submit`)).expect(201);
    await auth(api().post(`/api/v1/journal-entries/${je.body.id}/approve`)).expect(201);
    await auth(api().post(`/api/v1/journal-entries/${je.body.id}/post`)).expect(201);

    const byDept = await auth(
      api().get(
        `/api/v1/mis/drilldown?companyId=${companyId}&fromDate=2026-01-01&toDate=2026-01-31&groupBy=departmentId`,
      ),
    ).expect(200);
    const deptRow = byDept.body.find((d: any) => d.key === department.body.id);
    expect(deptRow).toBeDefined();

    const comparison = await auth(
      api().get(
        `/api/v1/mis/period-comparison?companyId=${companyId}` +
          `&currentFrom=2026-01-01&currentTo=2026-01-31` +
          `&previousFrom=2025-12-01&previousTo=2025-12-31`,
      ),
    ).expect(200);
    expect(comparison.body.current.revenue).toBe(300);
    expect(comparison.body.previous.revenue).toBe(0);
  });
});
