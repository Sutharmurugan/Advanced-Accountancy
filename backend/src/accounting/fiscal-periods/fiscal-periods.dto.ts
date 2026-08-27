import { IsIn, IsString } from 'class-validator';

export class SetPeriodStatusDto {
  @IsIn(['open', 'closed', 'locked'])
  status: 'open' | 'closed' | 'locked';
}

export class CompanyScopedQueryDto {
  @IsString()
  companyId: string;
}
