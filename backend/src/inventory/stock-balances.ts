import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('stock-balances')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('inventory.read')
export class StockBalancesController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
    @Query('warehouseId') warehouseId?: string,
  ) {
    return this.tenantPrisma.run(user.tenantId, (tx) =>
      tx.stockBalance.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          ...(warehouseId ? { warehouseId } : {}),
        },
      }),
    );
  }
}

@Controller('stock-moves')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('inventory.read')
export class StockMovesController {
  constructor(private readonly tenantPrisma: TenantPrismaService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
    @Query('productId') productId?: string,
  ) {
    return this.tenantPrisma.run(user.tenantId, (tx) =>
      tx.stockMove.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          ...(productId ? { productId } : {}),
        },
        orderBy: { moveDate: 'desc' },
      }),
    );
  }
}
