import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PlatformPrismaService } from '../src/common/prisma/platform-prisma.service';
import { PERMISSIONS } from '../src/common/permissions.catalog';
import { CsvBankFeedAdapter } from '../src/integrations/csv-bank-feed.adapter';
import { PeppolStubAdapter } from '../src/integrations/peppol-stub.adapter';
import { AttendanceStubAdapter } from '../src/integrations/attendance-stub.adapter';

/**
 * Phase 12 exit criterion (roadmap section J): "Each integration is an
 * adapter with zero changes to the core accounting engine."
 *
 * CsvBankFeedAdapter is exercised end to end here: parsing a CSV export
 * and feeding it through the exact same BankStatementsService.import()
 * a manual upload uses (already proven correct by the Phase 7 suite),
 * including the matching engine running over the resulting lines. The
 * Peppol/attendance adapters are documented stubs (see
 * adapters.interface.ts) — this test only confirms their contract shape
 * is callable, not that they reach a real external system, since none is
 * available in this environment.
 */
describe('Integrations (Phase 12 exit criterion)', () => {
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

  it('parses a CSV bank feed and imports it as a real, matched bank statement', async () => {
    const signup = await api()
      .post('/api/v1/auth/signup')
      .send({
        tenantName: 'intco',
        tenantSlug: 'intco',
        adminEmail: 'owner@intco.test',
        adminPassword: 'correct-horse-battery-staple',
      })
      .expect(201);
    const token = signup.body.accessToken as string;
    const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

    const company = await auth(api().post('/api/v1/companies')).send({
      name: 'Intco',
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
      sku: 'SKU-INT-1',
      name: 'Widget',
      uomId: uom.body.id,
    });
    const customer = await auth(api().post('/api/v1/customers')).send({
      companyId,
      code: 'CUST-XYZ',
      name: 'XYZ Traders',
    });
    const invoice = await auth(api().post('/api/v1/sales-invoices')).send({
      companyId,
      customerId: customer.body.id,
      invoiceDate: '2026-01-05',
      dueDate: '2026-02-04',
      currencyCode: 'SGD',
      lines: [{ productId: product.body.id, quantity: 1, unitPrice: 250 }],
    });
    const invoiceId = invoice.body.id;
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/submit`)).expect(201);
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/approve`)).expect(201);
    await auth(api().post(`/api/v1/sales-invoices/${invoiceId}/post`)).expect(201);

    const csv =
      'date,description,amount\n' +
      '2026-01-18,"PAYNOW FROM XYZ TRADERS",250\n' +
      '2026-01-19,BANK FEE,-5\n';

    const imported = await auth(api().post('/api/v1/integrations/bank-feed/import-csv')).send({
      companyId,
      bankAccountId: bankAccount.body.id,
      statementDate: '2026-01-20',
      csv,
    });
    expect(imported.status).toBe(201);
    expect(imported.body.lines).toHaveLength(2);

    const matched = imported.body.lines.find((l: any) => Number(l.amount) === 250);
    expect(matched.status).toBe('suggested');
    expect(matched.suggestedInvoiceId).toBe(invoiceId);
    expect(Number(matched.confidenceScore)).toBe(100);

    const unmatched = imported.body.lines.find((l: any) => Number(l.amount) === -5);
    expect(unmatched.status).toBe('unmatched');
  });

  it('confirms the CSV adapter rejects malformed input rather than silently misparsing it', () => {
    const adapter = new CsvBankFeedAdapter();
    expect(() => adapter.parse('not,a,valid\nheader')).toThrow();
    expect(() => adapter.parse('date,description,amount\n2026-01-01,Test,not-a-number')).toThrow();
  });

  it('documents the Peppol and attendance device adapters as callable stubs, not real external connections', async () => {
    const peppol = new PeppolStubAdapter();
    const result = await peppol.submitInvoice({
      invoiceNumber: 'INV-000001',
      invoiceDate: '2026-01-01',
      total: 100,
      currencyCode: 'SGD',
      customerName: 'Test Customer',
    });
    expect(result.status).toBe('queued');

    const attendance = new AttendanceStubAdapter();
    const events = await attendance.pullEvents('2026-01-01T00:00:00Z');
    expect(events).toEqual([]); // no real device connected in this environment
  });
});
