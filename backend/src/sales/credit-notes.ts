import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { AccountingEngineService } from '../accounting/accounting-engine.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreateCreditNoteDto {
  @IsString() companyId: string;
  @IsString() customerId: string;
  @IsOptional() @IsString() salesInvoiceId?: string;
  @IsDateString() creditNoteDate: string;
  @IsNumber() amount: number;
}

/**
 * A simplified representation of both "sales return" and general AR/revenue
 * adjustment, per the brief's grouping of those under credit notes — see
 * docs/architecture section 6. Posts CREDIT_NOTE_POSTED: debits Sales
 * Revenue, credits Accounts Receivable.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.creditNote.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateCreditNoteDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const creditNoteNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'CREDIT_NOTE',
        'CN-',
      );
      const creditNote = await tx.creditNote.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          customerId: dto.customerId,
          salesInvoiceId: dto.salesInvoiceId,
          creditNoteNumber,
          creditNoteDate: new Date(dto.creditNoteDate),
          amount: dto.amount,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'credit_note',
        entityId: creditNote.id,
        newValue: dto,
      });
      return creditNote;
    });
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const creditNote = await tx.creditNote.findUnique({ where: { id } });
      if (!creditNote) throw new NotFoundException('Credit note not found');
      if (creditNote.status !== 'draft') {
        throw new BadRequestException('Only a draft credit note can be posted');
      }

      const company = await tx.company.findUniqueOrThrow({ where: { id: creditNote.companyId } });
      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: creditNote.companyId,
        eventType: 'CREDIT_NOTE_POSTED',
        entryDate: creditNote.creditNoteDate,
        currencyCode: company.baseCurrencyCode,
        sourceModule: 'SALES',
        sourceDocType: 'credit_note',
        sourceDocId: creditNote.id,
        description: `Credit Note ${creditNote.creditNoteNumber}`,
        amounts: { amount: Number(creditNote.amount) },
        dimensions: { customerId: creditNote.customerId },
        createdBy: userId,
      });

      if (creditNote.salesInvoiceId) {
        await tx.salesInvoice.update({
          where: { id: creditNote.salesInvoiceId },
          data: { amountPaid: { increment: creditNote.amount } },
        });
      }

      const posted = await tx.creditNote.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: creditNote.companyId,
        userId,
        action: 'post',
        entityType: 'credit_note',
        entityId: id,
        newValue: { journalEntryId: entry.id },
      });
      return posted;
    });
  }
}

@Controller('credit-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('sales.manage')
export class CreditNotesController {
  constructor(private readonly creditNotes: CreditNotesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.creditNotes.list(user.tenantId, companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCreditNoteDto) {
    return this.creditNotes.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.creditNotes.post(user.tenantId, user.userId, id);
  }
}
