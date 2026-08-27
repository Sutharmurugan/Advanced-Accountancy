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
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateSupplierDto {
  @IsString() companyId: string;
  @IsString() code: string;
  @IsString() name: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() paymentTermId?: string;
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() paymentTermId?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class SuppliersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.supplier.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { code: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const supplier = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.supplier.findUnique({ where: { id } }),
    );
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  create(tenantId: string, userId: string, dto: CreateSupplierDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const supplier = await tx.supplier.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: supplier.companyId,
        userId,
        action: 'create',
        entityType: 'supplier',
        entityId: supplier.id,
        newValue: dto,
      });
      return supplier;
    });
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateSupplierDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.supplier.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Supplier not found');
      const after = await tx.supplier.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'supplier',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}

@Controller('suppliers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.suppliers.list(user.tenantId, companyId);
  }

  @Get(':id')
  @RequirePermissions('masterdata.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.suppliers.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSupplierDto) {
    return this.suppliers.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('masterdata.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.suppliers.update(user.tenantId, user.userId, id, dto);
  }
}
