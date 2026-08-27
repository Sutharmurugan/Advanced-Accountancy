import { Global, Module } from '@nestjs/common';
import { PlatformPrismaService } from './platform-prisma.service';
import { TenantPrismaService } from './tenant-prisma.service';

@Global()
@Module({
  providers: [PlatformPrismaService, TenantPrismaService],
  exports: [PlatformPrismaService, TenantPrismaService],
})
export class PrismaModule {}
