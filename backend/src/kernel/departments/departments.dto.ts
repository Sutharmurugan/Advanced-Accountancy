import { IsOptional, IsString } from 'class-validator';

export class CreateDepartmentDto {
  @IsString()
  companyId: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsString()
  name: string;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
