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
import { UserCompanyAccessService } from './user-company-access.service';
import { GrantAccessDto } from './user-company-access.dto';

@Controller('user-company-access')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('user_company_access.grant')
export class UserCompanyAccessController {
  constructor(private readonly access: UserCompanyAccessService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('userId') userId?: string,
  ) {
    return this.access.list(user.tenantId, userId);
  }

  @Post()
  grant(@CurrentUser() user: AuthenticatedUser, @Body() dto: GrantAccessDto) {
    return this.access.grant(user.tenantId, user.userId, dto);
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.access.revoke(user.tenantId, user.userId, id);
  }
}
