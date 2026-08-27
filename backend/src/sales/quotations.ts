import {
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
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { currentTaxRatePercent, round2 } from '../accounting/tax-rate.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class QuotationLineDto {
  @IsString() productId: string;
  @IsNumber() quantity: number;
  @IsNumber() unitPrice: number;
  @IsOptional() @IsString() taxCodeId?: string;
}

export class CreateQuotationDto {
  @IsString() companyId: string;
  @IsString() customerId: string;
  @IsDateString() quotationDate: string;
  @IsString() currencyCode: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuotationLineDto)
  lines: QuotationLineDto[];
}

@Injectable()
export class QuotationsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.quotation.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const quotation = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.quotation.findUnique({ where: { id }, include: { lines: true } }),
    );
    if (!quotation) throw new NotFoundException('Quotation not found');
    return quotation;
  }

  create(tenantId: string, userId: string, dto: CreateQuotationDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const quotationDate = new Date(dto.quotationDate);
      let subtotal = 0;
      let taxAmount = 0;
      const lines = [];
      for (const [idx, line] of dto.lines.entries()) {
        const lineTotal = round2(line.quantity * line.unitPrice);
        const rate = await currentTaxRatePercent(tx, line.taxCodeId, quotationDate);
        subtotal += lineTotal;
        taxAmount += round2((lineTotal * rate) / 100);
        lines.push({
          lineNo: idx + 1,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          taxCodeId: line.taxCodeId,
          lineTotal,
        });
      }

      const quotationNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'QUOTATION',
        'QUO-',
      );

      const quotation = await tx.quotation.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          customerId: dto.customerId,
          quotationNumber,
          quotationDate,
          currencyCode: dto.currencyCode,
          subtotal,
          taxAmount,
          total: subtotal + taxAmount,
          lines: { create: lines },
        },
        include: { lines: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'quotation',
        entityId: quotation.id,
        newValue: { quotationNumber, total: quotation.total },
      });
      return quotation;
    });
  }
}

@Controller('quotations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('sales.manage')
export class QuotationsController {
  constructor(private readonly quotations: QuotationsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.quotations.list(user.tenantId, companyId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.quotations.get(user.tenantId, id);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateQuotationDto) {
    return this.quotations.create(user.tenantId, user.userId, dto);
  }
}
