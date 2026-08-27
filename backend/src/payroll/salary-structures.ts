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
import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateSalaryStructureDto {
  @IsString() companyId: string;
  @IsString() employeeId: string;
  @IsNumber() @Min(0) basicSalary: number;
  @IsOptional() @IsNumber() @Min(0) allowances?: number;
  @IsOptional() @IsNumber() @Min(0) deductions?: number;
  @IsDateString() effectiveFrom: string;
}

@Injectable()
export class SalaryStructuresService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string, employeeId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.salaryStructure.findMany({
        where: {
          ...(companyId ? { companyId } : {}),
          ...(employeeId ? { employeeId } : {}),
        },
        orderBy: { effectiveFrom: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateSalaryStructureDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const structure = await tx.salaryStructure.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          employeeId: dto.employeeId,
          basicSalary: dto.basicSalary,
          allowances: dto.allowances ?? 0,
          deductions: dto.deductions ?? 0,
          effectiveFrom: new Date(dto.effectiveFrom),
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'salary_structure',
        entityId: structure.id,
        newValue: dto,
      });
      return structure;
    });
  }
}

@Controller('salary-structures')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('payroll.manage')
export class SalaryStructuresController {
  constructor(private readonly salaryStructures: SalaryStructuresService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.salaryStructures.list(user.tenantId, companyId, employeeId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalaryStructureDto) {
    return this.salaryStructures.create(user.tenantId, user.userId, dto);
  }
}
