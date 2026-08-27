import {
  Body,
  Controller,
  Get,
  Injectable,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsNumber, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { PlatformPrismaService } from '../common/prisma/platform-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateExchangeRateDto {
  @IsString() companyId: string;
  @IsString() fromCurrency: string;
  @IsString() toCurrency: string;
  @IsNumber() rate: number;
  @IsDateString() rateDate: string;
}

/** Global, non-tenant-scoped currency catalogue — same treatment as the
 * permission catalogue: read via the platform connection since `currencies`
 * carries no RLS policy and no business data. */
@Controller('currencies')
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  constructor(private readonly platformPrisma: PlatformPrismaService) {}

  @Get()
  list() {
    return this.platformPrisma.currency.findMany({ orderBy: { code: 'asc' } });
  }
}

@Injectable()
export class ExchangeRatesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.exchangeRate.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { rateDate: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateExchangeRateDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const rate = await tx.exchangeRate.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          fromCurrency: dto.fromCurrency,
          toCurrency: dto.toCurrency,
          rate: dto.rate,
          rateDate: new Date(dto.rateDate),
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'exchange_rate',
        entityId: rate.id,
        newValue: dto,
      });
      return rate;
    });
  }
}

@Controller('exchange-rates')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExchangeRatesController {
  constructor(private readonly exchangeRates: ExchangeRatesService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.exchangeRates.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateExchangeRateDto) {
    return this.exchangeRates.create(user.tenantId, user.userId, dto);
  }
}
