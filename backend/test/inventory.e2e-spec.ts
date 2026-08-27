import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 6 exit criterion (roadmap section J): "Stock levels and valuation
 * stay correct across a full sales+purchase cycle, deliveries triggering
 * COGS entries automatically."
 */
describe('Inventory (Phase 6 exit criterion)', () => {
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

  async function setupCompany(slug: string) {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: slug,
        tenantSlug: slug,
        adminEmail: `owner@${slug}.test`,
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: `${slug} Co`,
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const companyId = company.body.id as string;
    const uomRes = await auth(api().post('/api/v1/uoms')).send({ companyId, code: 'EA', name: 'Each' });
    const productRes = await auth(api().post('/api/v1/products')).send({
      companyId,
      sku: 'SKU-INV-1',
      name: 'Widget',
      uomId: uomRes.body.id,
    });
    const supplierRes = await auth(api().post('/api/v1/suppliers')).send({
      companyId,
      code: 'SUP-1',
      name: 'Test Supplier',
    });
    const customerRes = await auth(api().post('/api/v1/customers')).send({
      companyId,
      code: 'CUST-1',
      name: 'Test Customer',
    });
    const warehouseRes = await auth(api().post('/api/v1/warehouses')).send({
      companyId,
      name: 'Main Warehouse',
    });

    return {
      auth,
      companyId,
      productId: productRes.body.id as string,
      supplierId: supplierRes.body.id as string,
      customerId: customerRes.body.id as string,
      warehouseId: warehouseRes.body.id as string,
    };
  }

  it('goods receipt increases stock at cost; delivery decreases it and posts COGS automatically', async () => {
    const { auth, companyId, productId, warehouseId } = await setupCompany('inv1');

    // Receive 100 units at $4 each.
    const grn = await auth(api().post('/api/v1/goods-receipts')).send({
      companyId,
      warehouseId,
      receiptDate: '2026-01-05',
      lines: [{ productId, quantity: 100, unitCost: 4 }],
    });
    await auth(api().post(`/api/v1/goods-receipts/${grn.body.id}/post`)).expect(201);

    let balances = await auth(
      api().get(`/api/v1/stock-balances?companyId=${companyId}&warehouseId=${warehouseId}`),
    );
    expect(Number(balances.body[0].quantityOnHand)).toBe(100);
    expect(Number(balances.body[0].averageCost)).toBe(4);

    // Receive another 100 units at $6 each — weighted average should blend
    // to (100*4 + 100*6) / 200 = 5.
    const grn2 = await auth(api().post('/api/v1/goods-receipts')).send({
      companyId,
      warehouseId,
      receiptDate: '2026-01-06',
      lines: [{ productId, quantity: 100, unitCost: 6 }],
    });
    await auth(api().post(`/api/v1/goods-receipts/${grn2.body.id}/post`)).expect(201);

    balances = await auth(
      api().get(`/api/v1/stock-balances?companyId=${companyId}&warehouseId=${warehouseId}`),
    );
    expect(Number(balances.body[0].quantityOnHand)).toBe(200);
    expect(Number(balances.body[0].averageCost)).toBe(5);

    // Deliver 50 units — should draw down stock at the $5 average and post
    // a COGS entry of 50 * 5 = 250 automatically.
    const delivery = await auth(api().post('/api/v1/deliveries')).send({
      companyId,
      warehouseId,
      deliveryDate: '2026-01-10',
      lines: [{ productId, quantity: 50 }],
    });
    const postedDelivery = await auth(
      api().post(`/api/v1/deliveries/${delivery.body.id}/post`),
    ).expect(201);
    expect(postedDelivery.body.status).toBe('posted');
    expect(postedDelivery.body.journalEntryId).toBeTruthy();

    balances = await auth(
      api().get(`/api/v1/stock-balances?companyId=${companyId}&warehouseId=${warehouseId}`),
    );
    expect(Number(balances.body[0].quantityOnHand)).toBe(150);
    expect(Number(balances.body[0].averageCost)).toBe(5); // average unchanged by a stock-out

    const tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    const cogs = tb.body.find((r: any) => r.accountCode === '5000');
    const inventory = tb.body.find((r: any) => r.accountCode === '1200');
    expect(cogs.balance).toBe(250);
    expect(inventory.balance).toBe(-250); // credited by the delivery's COGS entry

    // Attempting to deliver more than is on hand must fail, not go negative.
    const overDelivery = await auth(api().post('/api/v1/deliveries')).send({
      companyId,
      warehouseId,
      deliveryDate: '2026-01-11',
      lines: [{ productId, quantity: 9999 }],
    });
    await auth(
      api().post(`/api/v1/deliveries/${overDelivery.body.id}/post`),
    ).expect(400);
  });

  it('posts a stock count variance to the Inventory control account', async () => {
    const { auth, companyId, productId, warehouseId } = await setupCompany('inv2');

    const grn = await auth(api().post('/api/v1/goods-receipts')).send({
      companyId,
      warehouseId,
      receiptDate: '2026-01-05',
      lines: [{ productId, quantity: 100, unitCost: 10 }],
    });
    await auth(api().post(`/api/v1/goods-receipts/${grn.body.id}/post`)).expect(201);

    // Physical count finds only 90 — a shrinkage of 10 units at $10 = $100.
    const count = await auth(api().post('/api/v1/stock-counts')).send({
      companyId,
      warehouseId,
      countDate: '2026-01-15',
      lines: [{ productId, countedQuantity: 90 }],
    });
    await auth(api().post(`/api/v1/stock-counts/${count.body.id}/post`)).expect(201);

    const balances = await auth(
      api().get(`/api/v1/stock-balances?companyId=${companyId}&warehouseId=${warehouseId}`),
    );
    expect(Number(balances.body[0].quantityOnHand)).toBe(90);

    const tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    const inventory = tb.body.find((r: any) => r.accountCode === '1200');
    const cogs = tb.body.find((r: any) => r.accountCode === '5000');
    expect(inventory.balance).toBe(-100); // credited (stock written down)
    expect(cogs.balance).toBe(100); // absorbed as COGS
  });
});
