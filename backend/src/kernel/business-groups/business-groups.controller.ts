import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { BusinessGroupsService } from './business-groups.service';
import {
  CreateBusinessGroupDto,
  UpdateBusinessGroupDto,
} from './business-groups.dto';

@Controller('business-groups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('business_group.manage')
export class BusinessGroupsController {
  constructor(private readonly groups: BusinessGroupsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.groups.list(user.tenantId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.groups.get(user.tenantId, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateBusinessGroupDto,
  ) {
    return this.groups.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateBusinessGroupDto,
  ) {
    return this.groups.update(user.tenantId, user.userId, id, dto);
  }
}
