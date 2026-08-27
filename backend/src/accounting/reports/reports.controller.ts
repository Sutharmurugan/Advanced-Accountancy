import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('report.read')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('trial-balance')
  trialBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId: string,
    @Query('asOfDate') asOfDate: string,
  ) {
    return this.reports.trialBalance(user.tenantId, companyId, asOfDate);
  }

  @Get('balance-sheet')
  balanceSheet(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId: string,
    @Query('asOfDate') asOfDate: string,
  ) {
    return this.reports.balanceSheet(user.tenantId, companyId, asOfDate);
  }

  @Get('profit-and-loss')
  profitAndLoss(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.profitAndLoss(user.tenantId, companyId, fromDate, toDate);
  }

  @Get('general-ledger')
  generalLedger(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId: string,
    @Query('accountId') accountId: string,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
  ) {
    return this.reports.generalLedger(
      user.tenantId,
      companyId,
      accountId,
      fromDate,
      toDate,
    );
  }
}
