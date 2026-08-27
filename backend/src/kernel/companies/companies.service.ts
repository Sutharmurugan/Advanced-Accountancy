import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { TenantPrismaService } from '../../common/prisma/tenant-prisma.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';

@Injectable()
export class CompaniesService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  list(tenantId: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.company.findMany({ orderBy: { createdAt: 'asc' } }),
    );
  }

  async get(tenantId: string, id: string) {
    const company = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.company.findUnique({ where: { id } }),
    );
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  create(tenantId: string, userId: string, dto: CreateCompanyDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const company = await tx.company.create({
        data: { tenantId, ...dto },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: company.id,
        userId,
        action: 'create',
        entityType: 'company',
        entityId: company.id,
        newValue: dto,
      });
      return company;
    });
  }

  async update(
    tenantId: string,
    userId: string,
    id: string,
    dto: UpdateCompanyDto,
  ) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const before = await tx.company.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Company not found');

      const after = await tx.company.update({ where: { id }, data: dto });
      await this.audit.record(tx, {
        tenantId,
        companyId: id,
        userId,
        action: 'edit',
        entityType: 'company',
        entityId: id,
        oldValue: before,
        newValue: after,
      });
      return after;
    });
  }
}
