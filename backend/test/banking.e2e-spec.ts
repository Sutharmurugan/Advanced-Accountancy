import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';

/**
 * Phase 7 exit criterion (roadmap section J): "A bank statement import
 * auto-suggests matches at high confidence and requires review below
 * threshold, and approved matches post/reconcile correctly."
 */
describe('Banking & reconciliation (Phase 7 exit criterion)', () => {
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

  it('auto-suggests a high-confidence match, leaves an unrelated line unmatched, and posts/reconciles on approval', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'bankco',
        tenantSlug: 'bankco',
        adminEmail: 'owner@bankco.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: 'Bankco',
      countryCode: 'SG',
      baseCurrencyCode: 'SGD',
    });
    const companyId = company.body.id as string;

    const coa = await auth(api().get(`/api/v1/chart-of-accounts?companyId=${companyId}`));
    const bankGlAccount = coa.body.find((a: any) => a.accountCode === '1900');
    const bankAccount = await auth(api().post('/api/v1/bank-accounts')).send({
      companyId,
      bankName: 'Test Bank',
      accountName: 'Operating',
      accountNumber: '000-1',
      currencyCode: 'SGD',
      glAccountId: bankGlAccount.id,
    });

    const uom = await auth(api().post('/api/v1/uoms')).send({ companyId, code: 'EA', name: 'Each' });
    const product = await auth(api().post('/api/v1/products')).send({
      companyId,
      sku: 'SKU-BANK-1',
      name: 'Widget',
      uomId: uom.body.id,
    });
    const customer = await auth(api().post('/api/v1/customers')).send({
      companyId,
      code: 'CUST-ACME',
      name: 'Acme Traders',
    });

    const invoice = await auth(api().post('/api/v1/sales-invoices')).send({
      companyId,
      customerId: customer.body.id,
      invoiceDate: '2026-01-05',
      dueDate: '2026-02-04',
      currencyCode: 'SGD',
      lines: [{ productId: product.body.id, quantity: 1, unitPrice: 500 }],
    });
    const invoiceId = invoice.body.id;
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/submit`)).expect(201);
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/approve`)).expect(201);
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/post`)).expect(201);

    // Import a statement: one line matches the invoice exactly by amount
    // AND mentions the customer's name (high confidence); one line matches
    // no open invoice at all (stays unmatched).
    const statement = await auth(api().post('/api/v1/bank-statements')).send({
      companyId,
      bankAccountId: bankAccount.body.id,
      statementDate: '2026-01-20',
      lines: [
        { transactionDate: '2026-01-18', description: 'PAYNOW FROM ACME TRADERS PTE LTD', amount: 500 },
        { transactionDate: '2026-01-19', description: 'UNKNOWN MISC CREDIT', amount: 37.5 },
      ],
    });
    expect(statement.status).toBe(201);
    const matchedLine = statement.body.lines.find((l: any) => Number(l.amount) === 500);
    const unmatchedLine = statement.body.lines.find((l: any) => Number(l.amount) === 37.5);

    expect(matchedLine.status).toBe('suggested');
    expect(matchedLine.suggestedType).toBe('customer_receipt');
    expect(matchedLine.suggestedInvoiceId).toBe(invoiceId);
    expect(Number(matchedLine.confidenceScore)).toBe(100); // amount + name both matched

    expect(unmatchedLine.status).toBe('unmatched');
    expect(unmatchedLine.suggestedInvoiceId).toBeNull();

    // Approve the high-confidence match — this should book and post a real
    // Customer Receipt allocated to the invoice.
    const approved = await auth(
      api().post(`/api/v1/bank-statements/lines/${matchedLine.id}/approve`),
    ).expect(201);
    expect(approved.body.status).toBe('reconciled');
    expect(approved.body.matchedJournalEntryId).toBeTruthy();

    const invoiceAfter = await auth(api().get(`/api/v1/sales-invoices/${invoiceId}`));
    expect(Number(invoiceAfter.body.amountPaid)).toBe(500);

    const tb = await auth(
      api().get(`/api/v1/reports/trial-balance?companyId=${companyId}&asOfDate=2026-01-31`),
    );
    const ar = tb.body.find((r: any) => r.accountCode === '1100');
    const bank = tb.body.find((r: any) => r.accountCode === '1900');
    expect(ar.balance).toBe(0);
    expect(bank.balance).toBe(500);

    // The unmatched line can be explicitly ignored (never silently posted).
    const ignored = await auth(
      api().post(`/api/v1/bank-statements/lines/${unmatchedLine.id}/ignore`),
    ).expect(201);
    expect(ignored.body.status).toBe('ignored');
  });
});
