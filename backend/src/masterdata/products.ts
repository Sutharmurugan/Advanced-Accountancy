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
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateProductDto {
  @IsString() companyId: string;
  @IsString() sku: string;
  @IsString() name: string;
  @IsString() uomId: string;
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() brandId?: string;
  @IsOptional() @IsBoolean() isInventoryTracked?: boolean;
  @IsOptional() @IsBoolean() isBatchTracked?: boolean;
  @IsOptional() @IsBoolean() isSerialTracked?: boolean;
  @IsOptional() @IsNumber() salesPrice?: number;
  @IsOptional() @IsNumber() purchasePrice?: number;
  @IsOptional() @IsString() taxCodeId?: string;
  @IsOptional() @IsNumber() reorderLevel?: number;
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() salesPrice?: number;
  @IsOptional() @IsNumber() purchasePrice?: number;
  @IsOptional() @IsNumber() reorderLevel?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.product.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { sku: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const product = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.product.findUnique({ where: { id } }),
    );
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  create(tenantId: string, userId: string, dto: CreateProductDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const product = await tx.product.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: product.companyId,
        userId,
        action: 'create',
        entityType: 'product',
        entityId: product.id,
        newValue: dto,
      });
      return product;
    });
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateProductDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Product not found');
      const after = await tx.product.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'product',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}

@Controller('products')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.products.list(user.tenantId, companyId);
  }

  @Get(':id')
  @RequirePermissions('masterdata.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.products.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProductDto) {
    return this.products.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('masterdata.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(user.tenantId, user.userId, id, dto);
  }
}
