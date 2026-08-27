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

export class CreateProductCategoryDto {
  @IsString() companyId: string;
  @IsString() name: string;
}
export class UpdateProductCategoryDto {
  @IsOptional() @IsString() name?: string;
}

@Injectable()
export class ProductCategoriesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.productCategory.findMany({ where: companyId ? { companyId } : undefined }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateProductCategoryDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const category = await tx.productCategory.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: category.companyId,
        userId,
        action: 'create',
        entityType: 'product_category',
        entityId: category.id,
        newValue: dto,
      });
      return category;
    });
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateProductCategoryDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.productCategory.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Product category not found');
      const after = await tx.productCategory.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'product_category',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}

@Controller('product-categories')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductCategoriesController {
  constructor(private readonly categories: ProductCategoriesService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.categories.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductCategoryDto) {
    return this.categories.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('masterdata.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductCategoryDto,
  ) {
    return this.categories.update(user.tenantId, user.userId, id, dto);
  }
}
