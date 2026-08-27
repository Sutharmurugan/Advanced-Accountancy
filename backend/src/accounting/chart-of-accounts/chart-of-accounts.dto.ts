import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

export class CreateChartOfAccountDto {
  @IsString()
  companyId: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsString()
  accountCode: string;

  @IsString()
  name: string;

  @IsIn(ACCOUNT_TYPES)
  accountType: string;

  @IsOptional()
  @IsString()
  controlType?: string;

  @IsOptional()
  @IsString()
  misCategory?: string;

  @IsOptional()
  @IsString()
  currencyCode?: string;
}

export class UpdateChartOfAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  misCategory?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
