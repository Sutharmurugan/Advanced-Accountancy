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
import { IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateUomDto {
  @IsString() companyId: string;
  @IsString() code: string;
  @IsString() name: string;
}

@Injectable()
export class UomsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.uom.findMany({ where: companyId ? { companyId } : undefined }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateUomDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const uom = await tx.uom.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: uom.companyId,
        userId,
        action: 'create',
        entityType: 'uom',
        entityId: uom.id,
        newValue: dto,
      });
      return uom;
    });
  }
}

@Controller('uoms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UomsController {
  constructor(private readonly uoms: UomsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.uoms.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateUomDto) {
    return this.uoms.create(user.tenantId, user.userId, dto);
  }
}
