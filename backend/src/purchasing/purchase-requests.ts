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
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class PurchaseRequestLineDto {
  @IsString() productId: string;
  @IsNumber() quantity: number;
}

export class CreatePurchaseRequestDto {
  @IsString() companyId: string;
  @IsDateString() requestDate: string;
  @IsOptional() @IsString() requestedBy?: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseRequestLineDto)
  lines: PurchaseRequestLineDto[];
}

@Injectable()
export class PurchaseRequestsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.purchaseRequest.findMany({
        where: companyId ? { companyId } : undefined,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreatePurchaseRequestDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const requestNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'PURCHASE_REQUEST',
        'PR-',
      );
      const req = await tx.purchaseRequest.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          requestNumber,
          requestDate: new Date(dto.requestDate),
          requestedBy: dto.requestedBy ?? userId,
          lines: {
            create: dto.lines.map((l, idx) => ({
              lineNo: idx + 1,
              productId: l.productId,
              quantity: l.quantity,
            })),
          },
        },
        include: { lines: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'purchase_request',
        entityId: req.id,
        newValue: { requestNumber },
      });
      return req;
    });
  }

  async approve(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const req = await tx.purchaseRequest.findUnique({ where: { id } });
      if (!req) throw new NotFoundException('Purchase request not found');
      if (req.status !== 'draft') {
        throw new BadRequestException('Only a draft request can be approved');
      }
      const updated = await tx.purchaseRequest.update({
        where: { id },
        data: { status: 'approved' },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: req.companyId,
        userId,
        action: 'approve',
        entityType: 'purchase_request',
        entityId: id,
      });
      return updated;
    });
  }
}

@Controller('purchase-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions('purchasing.manage')
export class PurchaseRequestsController {
  constructor(private readonly purchaseRequests: PurchaseRequestsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.purchaseRequests.list(user.tenantId, companyId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePurchaseRequestDto) {
    return this.purchaseRequests.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.purchaseRequests.approve(user.tenantId, user.userId, id);
  }
}
