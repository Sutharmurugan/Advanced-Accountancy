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

export class CreateDebitNoteDto {
  @IsString() companyId: string;
  @IsString() supplierId: string;
  @IsOptional() @IsString() supplierInvoiceId?: string;
  @IsDateString() debitNoteDate: string;
  @IsNumber() amount: number;
}

/** Mirrors CreditNotesService: purchase return / AP adjustment. Posts
 * DEBIT_NOTE_POSTED — debits Accounts Payable, credits Purchase Expense. */
@Injectable()
export class DebitNotesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.debitNote.findMany({
        where: companyId ? { companyId } : undefined,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreateDebitNoteDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const debitNoteNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'DEBIT_NOTE',
        'DN-',
      );
      const debitNote = await tx.debitNote.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          supplierId: dto.supplierId,
          supplierInvoiceId: dto.supplierInvoiceId,
          debitNoteNumber,
          debitNoteDate: new Date(dto.debitNoteDate),
          amount: dto.amount,
        },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'debit_note',
        entityId: debitNote.id,
        newValue: dto,
      });
      return debitNote;
    });
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const debitNote = await tx.debitNote.findUnique({ where: { id } });
      if (!debitNote) throw new NotFoundException('Debit note not found');
      if (debitNote.status !== 'draft') {
        throw new BadRequestException('Only a draft debit note can be posted');
      }

      const company = await tx.company.findUniqueOrThrow({ where: { id: debitNote.companyId } });
      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: debitNote.companyId,
        eventType: 'DEBIT_NOTE_POSTED',
        entryDate: debitNote.debitNoteDate,
        currencyCode: company.baseCurrencyCode,
        sourceModule: 'PURCHASING',
        sourceDocType: 'debit_note',
        sourceDocId: debitNote.id,
        description: `Debit Note ${debitNote.debitNoteNumber}`,
        amounts: { amount: Number(debitNote.amount) },
        dimensions: { supplierId: debitNote.supplierId },
        createdBy: userId,
      });

      if (debitNote.supplierInvoiceId) {
        await tx.supplierInvoice.update({
          where: { id: debitNote.supplierInvoiceId },
          data: { amountPaid: { increment: debitNote.amount } },
        });
      }

      const posted = await tx.debitNote.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: debitNote.companyId,
        userId,
        action: 'post',
        entityType: 'debit_note',
        entityId: id,
        newValue: { journalEntryId: entry.id },
      });
      return posted;
    });
  }
}

@Controller('debit-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('purchasing.manage')
export class DebitNotesController {
  constructor(private readonly debitNotes: DebitNotesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.debitNotes.list(user.tenantId, companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDebitNoteDto) {
    return this.debitNotes.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/post')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.debitNotes.post(user.tenantId, user.userId, id);
  }
}
