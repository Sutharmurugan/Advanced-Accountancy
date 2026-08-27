import { IsOptional, IsString } from 'class-validator';

export class CreateCostCentreDto {
  @IsString()
  companyId: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsString()
  code: string;

  @IsString()
  name: string;
}

export class UpdateCostCentreDto {
  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
