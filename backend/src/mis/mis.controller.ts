import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { MisService } from './mis.service';

const DRILLDOWN_DIMENSIONS = [
  'branchId',
  'departmentId',
  'costCentreId',
  'profitCentreId',
  'accountId',
] as const;

class DrilldownQueryDto {
  @IsString() companyId: string;
  @IsString() fromDate: string;
  @IsString() toDate: string;
  @IsIn(DRILLDOWN_DIMENSIONS) groupBy: (typeof DRILLDOWN_DIMENSIONS)[number];
  @IsOptional() @IsString() branchId?: string;
  @IsOptional() @IsString() departmentId?: string;
  @IsOptional() @IsString() costCentreId?: string;
  @IsOptional() @IsString() profitCentreId?: string;
}

@Controller('mis')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.read')
export class MisController {
  constructor(private readonly mis: MisService) {}

  @Get('dashboard')
  dashboard(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.mis.dashboard(user.tenantId, companyId, fromDate, toDate);
  }

  @Get('period-comparison')
  periodComparison(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId: string,
    @Query('currentFrom') currentFrom: string,
    @Query('currentTo') currentTo: string,
    @Query('previousFrom') previousFrom: string,
    @Query('previousTo') previousTo: string,
  ) {
    return this.mis.periodComparison(
      user.tenantId,
      companyId,
      currentFrom,
      currentTo,
      previousFrom,
      previousTo,
    );
  }

  @Get('drilldown')
  drilldown(@CurrentUser() user: AuthenticatedUser, @Query() query: DrilldownQueryDto) {
    return this.mis.drilldown(user.tenantId, query.companyId, query.fromDate, query.toDate, query.groupBy, {
      branchId: query.branchId,
      departmentId: query.departmentId,
      costCentreId: query.costCentreId,
      profitCentreId: query.profitCentreId,
    });
  }
}
