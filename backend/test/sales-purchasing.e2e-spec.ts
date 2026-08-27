import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 5 exit criterion (roadmap section J): "Quotation -> Order ->
 * Delivery -> Invoice -> Receipt and PR -> PO -> GRN -> Supplier Invoice ->
 * Payment both flow through to correct GL postings."
 *
 * Delivery/GRN themselves carry no GL impact yet (see comments in
 * src/sales/deliveries.ts and src/purchasing/goods-receipts.ts — that's
 * Phase 6's job), so this test exercises the full document chain end to
 * end and checks the ledger impact of the two documents that do post:
 * the Sales/Supplier Invoice and the Receipt/Payment.
 */
describe('Sales and Purchasing (Phase 5 exit criterion)', () => {
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

    const coa = await auth(
      api().get(`/api/v1/chart-of-accounts?companyId=${companyId}`),
    );
    const bankGlAccount = coa.body.find((a: any) => a.accountCode === '1900');

    const bankAccountRes = await auth(api().post('/api/v1/bank-accounts')).send({
      companyId,
      bankName: 'Test Bank',
      accountName: 'Operating Account',
      accountNumber: '000-123-456',
      currencyCode: 'SGD',
      glAccountId: bankGlAccount.id,
    });

    const uomRes = await auth(api().post('/api/v1/uoms')).send({ companyId, code: 'EA', name: 'Each' });
    const productRes = await auth(api().post('/api/v1/products')).send({
      companyId,
      sku: 'SKU-1',
      name: 'Widget',
      uomId: uomRes.body.id,
    });
    const customerRes = await auth(api().post('/api/v1/customers')).send({
      companyId,
      code: 'CUST-1',
      name: 'Test Customer',
    });
    const supplierRes = await auth(api().post('/api/v1/suppliers')).send({
      companyId,
      code: 'SUP-1',
      name: 'Test Supplier',
    });
    const warehouseRes = await auth(api().post('/api/v1/warehouses')).send({
      companyId,
      name: 'Main Warehouse',
    });

    return {
      token,
      auth,
      companyId,
      bankAccountId: bankAccountRes.body.id as string,
      productId: productRes.body.id as string,
      customerId: customerRes.body.id as string,
      supplierId: supplierRes.body.id as string,
      warehouseId: warehouseRes.body.id as string,
    };
  }

  it('Quotation -> Sales Order -> Delivery -> Invoice -> Receipt posts correctly to the GL', async () => {
    const ctx = await setupCompany('salesflow');
    const { auth, companyId, productId, customerId, warehouseId, bankAccountId } = ctx;

    const quotation = await auth(api().post('/api/v1/quotations')).send({
      companyId,
      customerId,
      quotationDate: '2026-01-05',
      currencyCode: 'SGD',
      lines: [{ productId, quantity: 10, unitPrice: 20 }],
    });
    expect(quotation.status).toBe(201);
    expect(Number(quotation.body.total)).toBe(200);

    const order = await auth(api().post('/api/v1/sales-orders')).send({
      companyId,
      customerId,
      quotationId: quotation.body.id,
      orderDate: '2026-01-06',
      currencyCode: 'SGD',
      lines: [{ productId, quantity: 10, unitPrice: 20 }],
    });
    expect(order.status).toBe(201);

    const delivery = await auth(api().post('/api/v1/deliveries')).send({
      companyId,
      salesOrderId: order.body.id,
      warehouseId,
      deliveryDate: '2026-01-07',
      lines: [{ productId, quantity: 10 }],
    });
    expect(delivery.status).toBe(201);

    const invoice = await auth(api().post('/api/v1/sales-invoices')).send({
      companyId,
      customerId,
      salesOrderId: order.body.id,
      invoiceDate: '2026-01-08',
      dueDate: '2026-02-07',
      currencyCode: 'SGD',
      lines: [{ productId, quantity: 10, unitPrice: 20 }],
    });
    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.total)).toBe(200);
    const invoiceId = invoice.body.id;

    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/submit`)).expect(201);
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/approve`)).expect(201);
    const posted = await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/post`)).expect(201);
    expect(posted.body.status).toBe('posted');
    expect(posted.body.journalEntryId).toBeTruthy();

    let tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    let ar = tb.body.find((r: any) => r.accountCode === '1100');
    let revenue = tb.body.find((r: any) => r.accountCode === '4000');
    expect(ar.balance).toBe(200);
    expect(revenue.balance).toBe(-200);

    const receipt = await auth(api().post('/api/v1/customer-receipts')).send({
      companyId,
      customerId,
      bankAccountId,
      receiptDate: '2026-01-20',
      allocations: [{ salesInvoiceId: invoiceId, amount: 200 }],
    });
    expect(receipt.status).toBe(201);
    const postedReceipt = await auth(
      api().post(`/api/v1/customer-receipts/${receipt.body.id}/post`),
    ).expect(201);
    expect(postedReceipt.body.status).toBe('posted');

    tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    ar = tb.body.find((r: any) => r.accountCode === '1100');
    const bank = tb.body.find((r: any) => r.accountCode === '1900');
    expect(ar.balance).toBe(0); // fully collected
    expect(bank.balance).toBe(200);

    const invoiceAfter = await auth(api().get(`/api/v1/sales-invoices/${invoiceId}`));
    expect(Number(invoiceAfter.body.amountPaid)).toBe(200);
  });

  it('Purchase Request -> Purchase Order -> Goods Receipt -> Supplier Invoice -> Payment posts correctly to the GL', async () => {
    const ctx = await setupCompany('purchflow');
    const { auth, companyId, productId, supplierId, warehouseId, bankAccountId } = ctx;

    const pr = await auth(api().post('/api/v1/purchase-requests')).send({
      companyId,
      requestDate: '2026-01-02',
      lines: [{ productId, quantity: 50 }],
    });
    await auth(api().post(`/api/v1/purchase-requests/${pr.body.id}/approve`)).expect(201);

    const po = await auth(api().post('/api/v1/purchase-orders')).send({
      companyId,
      supplierId,
      purchaseRequestId: pr.body.id,
      orderDate: '2026-01-03',
      currencyCode: 'SGD',
      lines: [{ productId, quantity: 50, unitPrice: 5 }],
    });
    expect(Number(po.body.total)).toBe(250);

    const grn = await auth(api().post('/api/v1/goods-receipts')).send({
      companyId,
      purchaseOrderId: po.body.id,
      warehouseId,
      receiptDate: '2026-01-10',
      lines: [{ productId, quantity: 50, unitCost: 5 }],
    });
    expect(grn.status).toBe(201);

    const invoice = await auth(api().post('/api/v1/supplier-invoices')).send({
      companyId,
      supplierId,
      purchaseOrderId: po.body.id,
      invoiceDate: '2026-01-11',
      dueDate: '2026-02-10',
      currencyCode: 'SGD',
      lines: [{ productId, quantity: 50, unitPrice: 5 }],
    });
    const invoiceId = invoice.body.id;
    await auth(api().post(`/api/v1/supplier-invoices/${invoiceId}/submit`)).expect(201);
    await auth(api().post(`/api/v1/supplier-invoices/${invoiceId}/approve`)).expect(201);
    const posted = await auth(api().post(`/api/v1/supplier-invoices/${invoiceId}/post`)).expect(201);
    expect(posted.body.status).toBe('posted');

    let tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    let ap = tb.body.find((r: any) => r.accountCode === '2100');
    let expense = tb.body.find((r: any) => r.accountCode === '5100');
    expect(ap.balance).toBe(-250); // credit balance shown in ledger (debit - credit) convention
    expect(expense.balance).toBe(250);

    const payment = await auth(api().post('/api/v1/supplier-payments')).send({
      companyId,
      supplierId,
      bankAccountId,
      paymentDate: '2026-01-25',
      allocations: [{ supplierInvoiceId: invoiceId, amount: 250 }],
    });
    const postedPayment = await auth(
      api().post(`/api/v1/supplier-payments/${payment.body.id}/post`),
    ).expect(201);
    expect(postedPayment.body.status).toBe('posted');

    tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    ap = tb.body.find((r: any) => r.accountCode === '2100');
    const bank = tb.body.find((r: any) => r.accountCode === '1900');
    expect(ap.balance).toBe(0); // fully paid
    expect(bank.balance).toBe(-250);

    const invoiceAfter = await auth(api().get(`/api/v1/supplier-invoices/${invoiceId}`));
    expect(Number(invoiceAfter.body.amountPaid)).toBe(250);
  });
});
