import { IsOptional, IsString } from 'class-validator';

export class CreateBusinessGroupDto {
  @IsString()
  name: string;
}

export class UpdateBusinessGroupDto {
  @IsOptional()
  @IsString()
  name?: string;
}
