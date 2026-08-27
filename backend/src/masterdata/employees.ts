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
import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateEmployeeDto {
  @IsString() companyId: string;
  @IsString() code: string;
  @IsString() name: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsDateString() hireDate?: string;
}

export class UpdateEmployeeDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsIn(['active', 'terminated']) status?: string;
}

@Injectable()
export class EmployeesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.employee.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { code: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const employee = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.employee.findUnique({ where: { id } }),
    );
    if (!employee) throw new NotFoundException('Employee not found');
    return employee;
  }

  create(tenantId: string, userId: string, dto: CreateEmployeeDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const employee = await tx.employee.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          code: dto.code,
          name: dto.name,
          email: dto.email,
          hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: employee.companyId,
        userId,
        action: 'create',
        entityType: 'employee',
        entityId: employee.id,
        newValue: dto,
      });
      return employee;
    });
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateEmployeeDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.employee.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Employee not found');
      const after = await tx.employee.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: before.companyId,
        userId,
        action: 'edit',
        entityType: 'employee',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.employees.list(user.tenantId, companyId);
  }

  @Get(':id')
  @RequirePermissions('masterdata.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.employees.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('masterdata.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(user.tenantId, user.userId, id, dto);
  }
}
