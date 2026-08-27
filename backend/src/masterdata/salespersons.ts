import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateSalespersonDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsOptional() @IsString() userId?: string;
}

@Injectable()
export class SalespersonsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.salesperson.findMany({ where: companyId ? { companyId } : undefined }),
    );
  }

  create(tenantId: string, createdBy: string, dto: CreateSalespersonDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const salesperson = await tx.salesperson.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: salesperson.companyId,
        userId: createdBy,
        action: 'create',
        entityType: 'salesperson',
        entityId: salesperson.id,
        newValue: dto,
      });
      return salesperson;
    });
  }
}

@Controller('salespersons')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SalespersonsController {
  constructor(private readonly salespersons: SalespersonsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.salespersons.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalespersonDto) {
    return this.salespersons.create(user.tenantId, user.userId, dto);
  }
}
