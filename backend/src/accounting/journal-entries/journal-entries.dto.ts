import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateJournalEntryLineDto {
  @IsString()
  accountId: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  debit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  credit?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  costCentreId?: string;

  @IsOptional()
  @IsString()
  profitCentreId?: string;

  @IsOptional()
  @IsString()
  projectId?: string;
}

export class CreateJournalEntryDto {
  @IsString()
  companyId: string;

  @IsDateString()
  entryDate: string;

  @IsString()
  currencyCode: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateJournalEntryLineDto)
  lines: CreateJournalEntryLineDto[];
}

export class ReverseJournalEntryDto {
  @IsOptional()
  @IsDateString()
  reversalDate?: string;
}
