import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '../src/common/permissions.catalog';

// Seeds using the platform (superuser) connection since `permissions` is a
// global, non-tenant-scoped catalogue with no RLS policy.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

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
