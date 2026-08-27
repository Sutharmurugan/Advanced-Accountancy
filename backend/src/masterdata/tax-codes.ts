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
import { IsDateString, IsNumber, IsString, Max, Min } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateTaxCodeDto {
  @IsString() companyId: string;
  @IsString() code: string;
  @IsString() name: string;
  @IsNumber() @Min(0) @Max(100) ratePercent: number;
  @IsDateString() effectiveFrom: string;
}

@Injectable()
export class TaxCodesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.taxCode.findMany({
        where: companyId ? { companyId } : undefined,
        include: { rates: { orderBy: { effectiveFrom: 'desc' } } },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateTaxCodeDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const taxCode = await tx.taxCode.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          code: dto.code,
          name: dto.name,
          rates: {
            create: {
              ratePercent: dto.ratePercent,
              effectiveFrom: new Date(dto.effectiveFrom),
            },
          },
        },
        include: { rates: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: taxCode.companyId,
        userId,
        action: 'create',
        entityType: 'tax_code',
        entityId: taxCode.id,
        newValue: dto,
      });
      return taxCode;
    });
  }
}

@Controller('tax-codes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TaxCodesController {
  constructor(private readonly taxCodes: TaxCodesService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.taxCodes.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaxCodeDto) {
    return this.taxCodes.create(user.tenantId, user.userId, dto);
  }
}
