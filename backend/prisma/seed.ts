import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../src/common/permissions.catalog';

// Seeds using the platform (superuser) connection since `permissions` and
// `currencies` are global, non-tenant-scoped catalogues with no RLS policy.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Covers the country/tax localisation list in
// docs/architecture/00-OMNIERP-ARCHITECTURE.md section 16.
const CURRENCIES = [
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'د.إ' },
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs' },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$' },
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
];

async function main() {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { module: permission.module, description: permission.description },
      create: permission,
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${PERMISSIONS.length} permissions.`);

  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({
      where: { code: currency.code },
      update: { name: currency.name, symbol: currency.symbol },
      create: currency,
    });
  }
  // eslint-disable-next-line no-console
  console.log(`Seeded ${CURRENCIES.length} currencies.`);
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
