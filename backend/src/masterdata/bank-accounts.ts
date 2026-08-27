import {
  Body,
  Controller,
  Get,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateBankAccountDto {
  @IsString() companyId: string;
  @IsString() bankName: string;
  @IsString() accountName: string;
  @IsString() accountNumber: string;
  @IsString() currencyCode: string;
  /** Chart of Accounts id this bank account posts to — commonly the
   * auto-provisioned "1900 Bank — Default" account, or another asset
   * account the company has created for a second bank. */
  @IsString() glAccountId: string;
}

@Injectable()
export class BankAccountsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.bankAccount.findMany({ where: companyId ? { companyId } : undefined }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateBankAccountDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const account = await tx.bankAccount.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: account.companyId,
        userId,
        action: 'create',
        entityType: 'bank_account',
        entityId: account.id,
        newValue: dto,
      });
      return account;
    });
  }
}

@Controller('bank-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BankAccountsController {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.bankAccounts.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateBankAccountDto) {
    return this.bankAccounts.create(user.tenantId, user.userId, dto);
  }
}
