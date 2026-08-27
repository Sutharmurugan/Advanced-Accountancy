import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsDateString, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';
import { CsvBankFeedAdapter } from './csv-bank-feed.adapter';
import { BankStatementsService } from '../banking/bank-statements';

export class ImportCsvBankFeedDto {
  @IsString() companyId: string;
  @IsString() bankAccountId: string;
  @IsDateString() statementDate: string;
  @IsString() csv: string;
}

/**
 * The one fully-real integration this phase ships: a bank feed adapter
 * that parses a CSV export (no network access required) and hands the
 * result to the exact same BankStatementsService.import() a manual
 * statement upload uses — proving the adapter pattern by using it for
 * real, not just describing it. See adapters.interface.ts for what's a
 * genuine integration here vs. a documented stub (Peppol, attendance
 * devices) that needs real external access this environment doesn't have.
 */
@Controller('integrations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('integration.manage')
export class IntegrationsController {
  constructor(
    private readonly csvBankFeed: CsvBankFeedAdapter,
    private readonly bankStatements: BankStatementsService,
  ) {}

  @Post('bank-feed/import-csv')
  importCsv(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportCsvBankFeedDto) {
    const lines = this.csvBankFeed.parse(dto.csv);
    return this.bankStatements.import(user.tenantId, user.userId, {
      companyId: dto.companyId,
      bankAccountId: dto.bankAccountId,
      statementDate: dto.statementDate,
      lines,
    });
  }
}
