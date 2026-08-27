import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.tenantPrisma.run(user.tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: user.tenantId } }),
    );
  }
}
