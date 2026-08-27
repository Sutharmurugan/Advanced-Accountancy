import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class InviteUserDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  password: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: string;
}
