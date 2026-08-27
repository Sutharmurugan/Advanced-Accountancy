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
import { ProfitCentresService } from './profit-centres.service';
import {
  CreateProfitCentreDto,
  UpdateProfitCentreDto,
} from './profit-centres.dto';

@Controller('profit-centres')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('profit_centre.manage')
export class ProfitCentresController {
  constructor(private readonly profitCentres: ProfitCentresService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
  ) {
    return this.profitCentres.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.profitCentres.get(user.tenantId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateProfitCentreDto,
  ) {
    return this.profitCentres.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateProfitCentreDto,
  ) {
    return this.profitCentres.update(user.tenantId, user.userId, id, dto);
  }
}
