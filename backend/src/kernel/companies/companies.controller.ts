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
import { CompaniesService } from './companies.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermissions('company.read')
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.companies.list(user.tenantId);
  }

  @Get(':id')
  @RequirePermissions('company.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.companies.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('company.create')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCompanyDto) {
    return this.companies.create(user.tenantId, user.userId, dto);
  }

  @Patch(':id')
  @RequirePermissions('company.update')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(user.tenantId, user.userId, id, dto);
  }
}
