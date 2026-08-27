import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

/**
 * Read-only listing of the global permission catalogue (see
 * src/common/permissions.catalog.ts). Not company- or tenant-scoped — every
 * authenticated user can see which permission codes exist, so an admin
 * screen can offer them when building a role. No RBAC check beyond "is
 * logged in": the catalogue itself carries no business data.
 */
@Controller('permissions')
@UseGuards(JwtAuthGuard)
export class PermissionsController {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  @Get()
  list() {
    return this.platformPrisma.permission.findMany({ orderBy: { code: 'asc' } });
  }
}
