import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { FiscalPeriodsService } from './fiscal-periods.service';
import { CompanyScopedQueryDto, SetPeriodStatusDto } from './fiscal-periods.dto';

@Controller('fiscal-years')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('fiscal_period.manage')
export class FiscalPeriodsController {
  constructor(private readonly fiscalPeriods: FiscalPeriodsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: CompanyScopedQueryDto) {
    return this.fiscalPeriods.listFiscalYears(user.tenantId, query.companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() body: CompanyScopedQueryDto) {
    return this.fiscalPeriods.createNextFiscalYear(
      user.tenantId,
      user.userId,
      body.companyId,
    );
  }

  @Patch('periods/:id')
  setPeriodStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetPeriodStatusDto,
  ) {
    return this.fiscalPeriods.setPeriodStatus(user.tenantId, user.userId, id, dto.status);
  }
}
