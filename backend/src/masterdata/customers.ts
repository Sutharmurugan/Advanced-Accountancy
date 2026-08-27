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

export class CreateCustomerDto {
  @IsString() companyId: string;
  @IsString() code: string;
  @IsString() name: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() paymentTermId?: string;
  @IsOptional() @IsNumber() creditLimit?: number;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() paymentTermId?: string;
  @IsOptional() @IsNumber() creditLimit?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.customer.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { code: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const customer = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.customer.findUnique({ where: { id } }),
    );
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  create(tenantId: string, userId: string, dto: CreateCustomerDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const customer = await tx.customer.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: customer.companyId,
        userId,
        action: 'create',
        entityType: 'customer',
        entityId: customer.id,
        newValue: dto,
      });
      return customer;
    });
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateCustomerDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.customer.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Customer not found');
      const after = await tx.customer.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'customer',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}

@Controller('customers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.customers.list(user.tenantId, companyId);
  }

  @Get(':id')
  @RequirePermissions('masterdata.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.customers.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('masterdata.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.update(user.tenantId, user.userId, id, dto);
  }
}
