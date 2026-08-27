import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsInt, IsNumber, IsString, Min } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { AccountingEngineService } from '../accounting/accounting-engine.service';
import { round2 } from '../accounting/tax-rate.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateFixedAssetDto {
  @IsString() companyId: string;
  @IsString() assetCode: string;
  @IsString() name: string;
  @IsDateString() acquisitionDate: string;
  @IsNumber() @Min(0) acquisitionCost: number;
  @IsInt() @Min(1) usefulLifeMonths: number;
  @IsNumber() @Min(0) residualValue: number;
  @IsString() assetAccountId: string;
  @IsString() depreciationExpenseAccountId: string;
  @IsString() accumulatedDepreciationAccountId: string;
}

/**
 * Straight-line depreciation, generated as one DepreciationSchedule row per
 * month at creation time. Posting a schedule row calls
 * AccountingEngineService.postEvent('ASSET_DEPRECIATION_POSTED', ...) with
 * accountOverrides pointing at *this asset's own* expense/accumulated
 * accounts (they vary per asset, unlike a company-wide control account —
 * see company-provisioning.data.ts's note on OVERRIDE: resolvers).
 */
@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.fixedAsset.findMany({
        where: companyId ? { companyId } : undefined,
        include: { depreciationSchedules: { orderBy: { periodNo: 'asc' } } },
        orderBy: { acquisitionDate: 'asc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const asset = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.fixedAsset.findUnique({
        where: { id },
        include: { depreciationSchedules: { orderBy: { periodNo: 'asc' } } },
      }),
    );
    if (!asset) throw new NotFoundException('Fixed asset not found');
    return asset;
  }

  create(tenantId: string, userId: string, dto: CreateFixedAssetDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const depreciableAmount = dto.acquisitionCost - dto.residualValue;
      const monthly = round2(depreciableAmount / dto.usefulLifeMonths);
      const acquisitionDate = new Date(dto.acquisitionDate);

      const schedules = [];
      let accumulated = 0;
      for (let i = 1; i <= dto.usefulLifeMonths; i++) {
        const isLast = i === dto.usefulLifeMonths;
        const amount = isLast ? round2(depreciableAmount - accumulated) : monthly;
        accumulated += amount;
        const periodDate = new Date(
          Date.UTC(acquisitionDate.getUTCFullYear(), acquisitionDate.getUTCMonth() + i, 0),
        );
        schedules.push({ periodNo: i, periodDate, amount });
      }

      const asset = await tx.fixedAsset.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          assetCode: dto.assetCode,
          name: dto.name,
          acquisitionDate,
          acquisitionCost: dto.acquisitionCost,
          usefulLifeMonths: dto.usefulLifeMonths,
          residualValue: dto.residualValue,
          assetAccountId: dto.assetAccountId,
          depreciationExpenseAccountId: dto.depreciationExpenseAccountId,
          accumulatedDepreciationAccountId: dto.accumulatedDepreciationAccountId,
          depreciationSchedules: { create: schedules },
        },
        include: { depreciationSchedules: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'fixed_asset',
        entityId: asset.id,
        newValue: { assetCode: dto.assetCode, monthlyDepreciation: monthly },
      });
      return asset;
    });
  }

  /** Posts every still-pending depreciation schedule whose period date is
   * on or before `asOfDate`, across the whole company — "depreciation
   * posts automatically per period" (roadmap Phase 9 exit criterion). */
  async runDepreciation(tenantId: string, userId: string, companyId: string, asOfDate: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const cutoff = new Date(asOfDate);
      const pending = await tx.depreciationSchedule.findMany({
        where: {
          status: 'pending',
          periodDate: { lte: cutoff },
          fixedAsset: { companyId },
        },
        include: { fixedAsset: true },
        orderBy: { periodDate: 'asc' },
      });

      const posted = [];
      for (const schedule of pending) {
        const entry = await this.engine.postEvent(tx, {
          tenantId,
          companyId,
          eventType: 'ASSET_DEPRECIATION_POSTED',
          entryDate: schedule.periodDate,
          currencyCode: (await tx.company.findUniqueOrThrow({ where: { id: companyId } }))
            .baseCurrencyCode,
          sourceModule: 'ASSETS',
          sourceDocType: 'depreciation_schedule',
          sourceDocId: schedule.id,
          description: `Depreciation ${schedule.fixedAsset.assetCode} period ${schedule.periodNo}`,
          amounts: { amount: Number(schedule.amount) },
          accountOverrides: {
            depreciationExpenseAccount: schedule.fixedAsset.depreciationExpenseAccountId,
            accumulatedDepreciationAccount: schedule.fixedAsset.accumulatedDepreciationAccountId,
          },
          createdBy: userId,
        });
        const updated = await tx.depreciationSchedule.update({
          where: { id: schedule.id },
          data: { status: 'posted', journalEntryId: entry.id, postedAt: new Date() },
        });
        posted.push(updated);
      }

      if (posted.length === 0) {
        throw new BadRequestException('No pending depreciation schedules due by this date');
      }

      await this.audit.record(tx, {
        tenantId,
        companyId,
        userId,
        action: 'post',
        entityType: 'depreciation_schedule',
        newValue: { count: posted.length, asOfDate },
      });
      return posted;
    });
  }
}

@Controller('fixed-assets')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('assets.manage')
export class FixedAssetsController {
  constructor(private readonly fixedAssets: FixedAssetsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.fixedAssets.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.fixedAssets.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateFixedAssetDto) {
    return this.fixedAssets.create(user.tenantId, user.userId, dto);
  }

  @Post('run-depreciation')
  runDepreciation(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { companyId: string; asOfDate: string },
  ) {
    return this.fixedAssets.runDepreciation(
      user.tenantId,
      user.userId,
      body.companyId,
      body.asOfDate,
    );
  }
}
