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
import { IsInt, IsString, Min } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreatePaymentTermDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsInt() @Min(0) netDays: number;
}

@Injectable()
export class PaymentTermsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.paymentTerm.findMany({ where: companyId ? { companyId } : undefined }),
    );
  }

  create(tenantId: string, userId: string, dto: CreatePaymentTermDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const term = await tx.paymentTerm.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: term.companyId,
        userId,
        action: 'create',
        entityType: 'payment_term',
        entityId: term.id,
        newValue: dto,
      });
      return term;
    });
  }
}

@Controller('payment-terms')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PaymentTermsController {
  constructor(private readonly paymentTerms: PaymentTermsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.paymentTerms.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePaymentTermDto) {
    return this.paymentTerms.create(user.tenantId, user.userId, dto);
  }
}
