import {
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Patch,
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

export class CreateBrandDto {
  @IsString() companyId: string;
  @IsString() name: string;
}
export class UpdateBrandDto {
  @IsOptional() @IsString() name?: string;
}

@Injectable()
export class BrandsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.brand.findMany({ where: companyId ? { companyId } : undefined }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateBrandDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const brand = await tx.brand.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: brand.companyId,
        userId,
        action: 'create',
        entityType: 'brand',
        entityId: brand.id,
        newValue: dto,
      });
      return brand;
    });
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateBrandDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.brand.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Brand not found');
      const after = await tx.brand.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'brand',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}

@Controller('brands')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BrandsController {
  constructor(private readonly brands: BrandsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.brands.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBrandDto) {
    return this.brands.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('masterdata.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brands.update(user.tenantId, user.userId, id, dto);
  }
}
