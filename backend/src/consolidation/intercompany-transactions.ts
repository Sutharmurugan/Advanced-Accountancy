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
import { IsNumber, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class RecordIntercompanyTransactionDto {
  @IsString() businessGroupId: string;
  @IsString() companyAId: string;
  @IsString() companyBId: string;
  @IsString() companyAEntryId: string;
  @IsNumber() amount: number;
  @IsString() currencyCode: string;
}

export class MatchIntercompanyTransactionDto {
  @IsString() companyBEntryId: string;
}

/**
 * Tags a pair of journal entries in two companies of the same group as one
 * intercompany transaction (e.g. Singapore invoices Malaysia — each side
 * already posted its own normal Sales/Purchase entry; this just links
 * them). A transaction starts 'unmatched' until the counterparty side is
 * recorded, and ConsolidationRunsService refuses to finalize a run while
 * any 'unmatched' transaction exists for that group — the mandatory
 * pre-run mismatch report from section I.
 */
@Injectable()
export class IntercompanyTransactionsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, businessGroupId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.intercompanyTransaction.findMany({
        where: businessGroupId ? { businessGroupId } : undefined,
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: RecordIntercompanyTransactionDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const record = await tx.intercompanyTransaction.create({
        data: { tenantId, ...dto },
      });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'create',
        entityType: 'intercompany_transaction',
        entityId: record.id,
        newValue: dto,
      });
      return record;
    });
  }

  async match(
    tenantId: string,
    userId: string,
    id: string,
    dto: MatchIntercompanyTransactionDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const record = await tx.intercompanyTransaction.findUnique({ where: { id } });
      if (!record) throw new NotFoundException('Intercompany transaction not found');
      if (record.status !== 'unmatched') {
        throw new BadRequestException('Only an unmatched transaction can be matched');
      }
      const updated = await tx.intercompanyTransaction.update({
        where: { id },
        data: { companyBEntryId: dto.companyBEntryId, status: 'matched' },
      });
      await this.audit.record(tx, {
        tenantId,
        userId,
        action: 'edit',
        entityType: 'intercompany_transaction',
        entityId: id,
        newValue: { status: 'matched' },
      });
      return updated;
    });
  }
}

@Controller('intercompany-transactions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('consolidation.manage')
export class IntercompanyTransactionsController {
  constructor(private readonly intercompany: IntercompanyTransactionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('businessGroupId') businessGroupId?: string,
  ) {
    return this.intercompany.list(user.tenantId, businessGroupId);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RecordIntercompanyTransactionDto,
  ) {
    return this.intercompany.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/match')
  match(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: MatchIntercompanyTransactionDto,
  ) {
    return this.intercompany.match(user.tenantId, user.userId, id, dto);
  }
}
