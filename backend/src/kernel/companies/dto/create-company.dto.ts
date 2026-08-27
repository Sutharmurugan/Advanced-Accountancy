import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateCompanyDto {
  @IsOptional()
  @IsString()
  businessGroupId?: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  legalName?: string;

  @IsString()
  countryCode: string;

  @IsString()
  baseCurrencyCode: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  fiscalYearStartMonth?: number;

  @IsOptional()
  @IsString()
  taxRegistrationNo?: string;
}
