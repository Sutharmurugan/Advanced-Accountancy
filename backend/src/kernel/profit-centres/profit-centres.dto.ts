import { IsOptional, IsString } from 'class-validator';

export class CreateProfitCentreDto {
  @IsString()
  companyId: string;

  @IsString()
  code: string;

  @IsString()
  name: string;
}

export class UpdateProfitCentreDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;
}
