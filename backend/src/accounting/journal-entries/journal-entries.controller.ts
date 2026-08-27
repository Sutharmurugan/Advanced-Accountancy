import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  AuthenticatedUser,
  CurrentUser,
} from '../../common/decorators/current-user.decorator';
import { JournalEntriesService } from './journal-entries.service';
import { CreateJournalEntryDto, ReverseJournalEntryDto } from './journal-entries.dto';

@Controller('journal-entries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class JournalEntriesController {
  constructor(private readonly journalEntries: JournalEntriesService) {}

  @Get()
  @RequirePermissions('journal_entry.read')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('companyId') companyId?: string,
  ) {
    return this.journalEntries.list(user.tenantId, companyId);
  }

  @Get(':id')
  @RequirePermissions('journal_entry.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.journalEntries.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('journal_entry.create')
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.journalEntries.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/submit')
  @RequirePermissions('journal_entry.create')
  submit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.journalEntries.submit(user.tenantId, user.userId, id);
  }

  @Post(':id/approve')
  @RequirePermissions('journal_entry.approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.journalEntries.approve(user.tenantId, user.userId, id);
  }

  @Post(':id/post')
  @RequirePermissions('journal_entry.approve')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.journalEntries.post(user.tenantId, user.userId, id);
  }

  @Post(':id/reverse')
  @RequirePermissions('journal_entry.reverse')
  reverse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReverseJournalEntryDto,
  ) {
    return this.journalEntries.reverse(
      user.tenantId,
      user.userId,
      id,
      dto.reversalDate,
    );
  }
}
