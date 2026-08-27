import { IsArray, IsOptional, IsString } from 'class-validator';

export class GrantAccessDto {
  @IsString()
  userId: string;

  @IsOptional()
  @IsString()
  companyId?: string; // omit for a tenant-wide grant

  @IsString()
  roleId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  branchScope?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  departmentScope?: string[];
}
