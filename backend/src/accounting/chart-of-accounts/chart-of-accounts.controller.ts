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
import { ChartOfAccountsService } from './chart-of-accounts.service';
import {
  CreateChartOfAccountDto,
  UpdateChartOfAccountDto,
} from './chart-of-accounts.dto';

@Controller('chart-of-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChartOfAccountsController {
  constructor(private readonly coa: ChartOfAccountsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
  ) {
    return this.coa.list(user.tenantId, companyId);
  }

  @Get(':id')
  @RequirePermissions('masterdata.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.coa.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateChartOfAccountDto,
  ) {
    return this.coa.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('masterdata.manage')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateChartOfAccountDto,
  ) {
    return this.coa.update(user.tenantId, user.userId, id, dto);
  }
}
