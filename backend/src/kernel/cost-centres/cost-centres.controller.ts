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
import { CostCentresService } from './cost-centres.service';
import { CreateCostCentreDto, UpdateCostCentreDto } from './cost-centres.dto';

@Controller('cost-centres')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('cost_centre.manage')
export class CostCentresController {
  constructor(private readonly costCentres: CostCentresService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
  ) {
    return this.costCentres.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.costCentres.get(user.tenantId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCostCentreDto,
  ) {
    return this.costCentres.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCostCentreDto,
  ) {
    return this.costCentres.update(user.tenantId, user.userId, id, dto);
  }
}
