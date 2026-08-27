import { Module } from '@nestjs/common';
import { TenantsController } from './tenants/tenants.controller';
import { BusinessGroupsController } from './business-groups/business-groups.controller';
import { BusinessGroupsService } from './business-groups/business-groups.service';
import { CompaniesController } from './companies/companies.controller';
import { CompaniesService } from './companies/companies.service';
import { BranchesController } from './branches/branches.controller';
import { BranchesService } from './branches/branches.service';
import { DepartmentsController } from './departments/departments.controller';
import { DepartmentsService } from './departments/departments.service';
import { CostCentresController } from './cost-centres/cost-centres.controller';
import { CostCentresService } from './cost-centres/cost-centres.service';
import { ProfitCentresController } from './profit-centres/profit-centres.controller';
import { ProfitCentresService } from './profit-centres/profit-centres.service';
import { WarehousesController } from './warehouses/warehouses.controller';
import { WarehousesService } from './warehouses/warehouses.service';
import { PermissionsController } from './permissions/permissions.controller';
import { RolesController } from './roles/roles.controller';
import { RolesService } from './roles/roles.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { UserCompanyAccessController } from './user-company-access/user-company-access.controller';
import { UserCompanyAccessService } from './user-company-access/user-company-access.service';

@Module({
  controllers: [
    TenantsController,
    BusinessGroupsController,
    CompaniesController,
    BranchesController,
    DepartmentsController,
    CostCentresController,
    ProfitCentresController,
    WarehousesController,
    PermissionsController,
    RolesController,
    UsersController,
    UserCompanyAccessController,
  ],
  providers: [
    BusinessGroupsService,
    CompaniesService,
    BranchesService,
    DepartmentsService,
    CostCentresService,
    ProfitCentresService,
    WarehousesService,
    RolesService,
    UsersService,
    UserCompanyAccessService,
  ],
})
export class KernelModule {}
