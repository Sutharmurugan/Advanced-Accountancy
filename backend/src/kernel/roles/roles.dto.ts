import { IsOptional, IsString } from 'class-validator';

export class CreateRoleDto {
  @IsOptional()
  @IsString()
  companyId?: string; // omit for a tenant-wide role

  @IsString()
  name: string;
}

export class AddRolePermissionDto {
  @IsString()
  permissionCode: string;
}
