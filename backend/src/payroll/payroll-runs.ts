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
import { IsArray, IsDateString, IsOptional, IsString } from 'class-validator';
import { AuditService } from '../common/audit/audit.service';
import { TenantPrismaService } from '../common/prisma/tenant-prisma.service';
import { NumberingService } from '../accounting/numbering.service';
import { AccountingEngineService } from '../accounting/accounting-engine.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { AuthenticatedUser, CurrentUser } from '../common/decorators/current-user.decorator';

export class CreatePayrollRunDto {
  @IsString() companyId: string;
  @IsDateString() periodStart: string;
  @IsDateString() periodEnd: string;
  /** Omit to run payroll for every active employee of the company. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  employeeIds?: string[];
}

/**
 * A payroll run posts ONE aggregate journal entry for the whole run
 * (PAYROLL_RUN_POSTED: Debit Salary Expense, Credit Salary Payable +
 * Statutory Payable) rather than one per employee — see the schema
 * comment on PayrollRun and section D's example. Per-employee detail lives
 * in Payslip rows, not in separate ledger entries.
 */
@Injectable()
export class PayrollRunsService {
  constructor(
    private readonly tenantPrisma: TenantPrismaService,
    private readonly audit: AuditService,
    private readonly numbering: NumberingService,
    private readonly engine: AccountingEngineService,
  ) {}

  list(tenantId: string, companyId?: string) {
    return this.tenantPrisma.run(tenantId, (tx) =>
      tx.payrollRun.findMany({
        where: companyId ? { companyId } : undefined,
        include: { payslips: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  async get(tenantId: string, id: string) {
    const run = await this.tenantPrisma.run(tenantId, (tx) =>
      tx.payrollRun.findUnique({ where: { id }, include: { payslips: true } }),
    );
    if (!run) throw new NotFoundException('Payroll run not found');
    return run;
  }

  create(tenantId: string, userId: string, dto: CreatePayrollRunDto) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const employees = await tx.employee.findMany({
        where: {
          companyId: dto.companyId,
          status: 'active',
          ...(dto.employeeIds ? { id: { in: dto.employeeIds } } : {}),
        },
      });
      if (employees.length === 0) {
        throw new BadRequestException('No active employees to run payroll for');
      }

      const periodEnd = new Date(dto.periodEnd);
      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      const payslips = [];

      for (const employee of employees) {
        const structure = await tx.salaryStructure.findFirst({
          where: { employeeId: employee.id, effectiveFrom: { lte: periodEnd } },
          orderBy: { effectiveFrom: 'desc' },
        });
        if (!structure) continue; // no salary structure yet — skip, don't guess

        const gross = Number(structure.basicSalary) + Number(structure.allowances);
        const deductions = Number(structure.deductions);
        const net = gross - deductions;
        totalGross += gross;
        totalDeductions += deductions;
        totalNet += net;
        payslips.push({ employeeId: employee.id, grossPay: gross, deductions, netPay: net });
      }

      if (payslips.length === 0) {
        throw new BadRequestException(
          'None of the selected employees have a salary structure effective by the period end',
        );
      }

      const runNumber = await this.numbering.next(
        tx,
        dto.companyId,
        tenantId,
        'PAYROLL_RUN',
        'PAY-RUN-',
      );

      const run = await tx.payrollRun.create({
        data: {
          tenantId,
          companyId: dto.companyId,
          runNumber,
          periodStart: new Date(dto.periodStart),
          periodEnd,
          totalGross,
          totalDeductions,
          totalNet,
          payslips: { create: payslips },
        },
        include: { payslips: true },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: dto.companyId,
        userId,
        action: 'create',
        entityType: 'payroll_run',
        entityId: run.id,
        newValue: { runNumber, totalGross, totalNet, employeeCount: payslips.length },
      });
      return run;
    });
  }

  approve(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'draft') {
        throw new BadRequestException('Only a draft payroll run can be approved');
      }
      const updated = await tx.payrollRun.update({ where: { id }, data: { status: 'approved' } });
      await this.audit.record(tx, {
        tenantId,
        companyId: run.companyId,
        userId,
        action: 'approve',
        entityType: 'payroll_run',
        entityId: id,
      });
      return updated;
    });
  }

  async post(tenantId: string, userId: string, id: string) {
    return this.tenantPrisma.run(tenantId, async (tx) => {
      const run = await tx.payrollRun.findUnique({ where: { id } });
      if (!run) throw new NotFoundException('Payroll run not found');
      if (run.status !== 'approved') {
        throw new BadRequestException('Only an approved payroll run can be posted');
      }

      const company = await tx.company.findUniqueOrThrow({ where: { id: run.companyId } });
      const entry = await this.engine.postEvent(tx, {
        tenantId,
        companyId: run.companyId,
        eventType: 'PAYROLL_RUN_POSTED',
        entryDate: run.periodEnd,
        currencyCode: company.baseCurrencyCode,
        sourceModule: 'PAYROLL',
        sourceDocType: 'payroll_run',
        sourceDocId: run.id,
        description: `Payroll Run ${run.runNumber}`,
        amounts: {
          totalGross: Number(run.totalGross),
          totalNet: Number(run.totalNet),
          totalDeductions: Number(run.totalDeductions),
        },
        createdBy: userId,
      });

      const posted = await tx.payrollRun.update({
        where: { id },
        data: { status: 'posted', journalEntryId: entry.id, postedAt: new Date() },
      });
      await this.audit.record(tx, {
        tenantId,
        companyId: run.companyId,
        userId,
        action: 'post',
        entityType: 'payroll_run',
        entityId: id,
        newValue: { journalEntryId: entry.id },
      });
      return posted;
    });
  }
}

@Controller('payroll-runs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PayrollRunsController {
  constructor(private readonly payrollRuns: PayrollRunsService) {}

  @Get()
  @RequirePermissions('payroll.read')
  list(@CurrentUser() user: AuthenticatedUser, @Query('companyId') companyId?: string) {
    return this.payrollRuns.list(user.tenantId, companyId);
  }

  @Get(':id')
  @RequirePermissions('payroll.read')
  get(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payrollRuns.get(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('payroll.manage')
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePayrollRunDto) {
    return this.payrollRuns.create(user.tenantId, user.userId, dto);
  }

  @Post(':id/approve')
  @RequirePermissions('payroll.manage')
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payrollRuns.approve(user.tenantId, user.userId, id);
  }

  @Post(':id/post')
  @RequirePermissions('payroll.manage')
  post(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payrollRuns.post(user.tenantId, user.userId, id);
  }
}
