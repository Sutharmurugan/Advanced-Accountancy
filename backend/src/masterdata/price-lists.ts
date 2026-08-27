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
import { IsArray, IsNumber, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreatePriceListDto {
  @IsString() companyId: string;
  @IsString() name: string;
  @IsString() currencyCode: string;
}

export class PriceListItemDto {
  @IsString() productId: string;
  @IsNumber() price: number;
}

export class SetPriceListItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PriceListItemDto)
  items: PriceListItemDto[];
}

@Injectable()
export class PriceListsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.priceList.findMany({
        where: companyId ? { companyId } : undefined,
        include: { items: true },
      }),
    );
  }

  create(tenantId: string, userId: string, dto: CreatePriceListDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const priceList = await tx.priceList.create({ data: { tenantId, ...dto } });
      await this.audit.record(tx, {
        tenantId,
        companyId: priceList.companyId,
        userId,
        action: 'create',
        entityType: 'price_list',
        entityId: priceList.id,
        newValue: dto,
      });
      return priceList;
    });
  }

  async setItems(
    tenantId: string,
    userId: string,
    priceListId: string,
    dto: SetPriceListItemsDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const priceList = await tx.priceList.findUnique({ where: { id: priceListId } });
      if (!priceList) throw new NotFoundException('Price list not found');

      await tx.priceListItem.deleteMany({ where: { priceListId } });
      await tx.priceListItem.createMany({
        data: dto.items.map((item) => ({
          priceListId,
          productId: item.productId,
          price: item.price,
        })),
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: priceList.companyId,
        userId,
        action: 'edit',
        entityType: 'price_list',
        entityId: priceListId,
        newValue: { itemCount: dto.items.length },
      });
      return tx.priceList.findUnique({ where: { id: priceListId }, include: { items: true } });
    });
  }
}

@Controller('price-lists')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PriceListsController {
  constructor(private readonly priceLists: PriceListsService) {}

  @Get()
  @RequirePermissions('masterdata.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.priceLists.list(user.tenantId, companyId);
  }

  @Post()
  @RequirePermissions('masterdata.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePriceListDto) {
    return this.priceLists.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/items')
  @RequirePermissions('masterdata.manage')
  setItems(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetPriceListItemsDto,
  ) {
    return this.priceLists.setItems(user.tenantId, user.userId, id, dto);
  }
}
