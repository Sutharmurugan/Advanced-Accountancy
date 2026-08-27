import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
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
import { RolesService } from './roles.service';
import { AddRolePermissionDto, CreateRoleDto } from './roles.dto';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('role.manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
  ) {
    return this.roles.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.roles.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateRoleDto) {
    return this.roles.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/permissions')
  addPermission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddRolePermissionDto,
  ) {
    return this.roles.addPermission(
      user.tenantId,
      user.userId,
      id,
      dto.permissionCode,
    );
  }

  @Delete(':id/permissions/:permissionCode')
  removePermission(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('permissionCode') permissionCode: string,
  ) {
    return this.roles.removePermission(
      user.tenantId,
      user.userId,
      id,
      permissionCode,
    );
  }
}
