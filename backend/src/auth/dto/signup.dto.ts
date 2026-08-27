import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class SignupDto {
  @IsString()
  @MinLength(2)
  tenantName: string;

  @IsString()
  @Matches(/^[a-z0-9](-?[a-z0-9])*$/, {
    message:
      'tenantSlug must be lowercase letters, numbers and single hyphens only',
  })
  tenantSlug: string;

  @IsEmail()
  adminEmail: string;

  @IsString()
  @MinLength(10, { message: 'password must be at least 10 characters' })
  adminPassword: string;
}
