import { Module } from '@nestjs/common';
import { CustomersController, CustomersService } from './customers';
import { SuppliersController, SuppliersService } from './suppliers';
import { EmployeesController, EmployeesService } from './employees';
import { ProductCategoriesController, ProductCategoriesService } from './product-categories';
import { BrandsController, BrandsService } from './brands';
import { UomsController, UomsService } from './uoms';
import { ProductsController, ProductsService } from './products';
import { SalespersonsController, SalespersonsService } from './salespersons';
import { ProjectsController, ProjectsService } from './projects';
import { PaymentTermsController, PaymentTermsService } from './payment-terms';
import { TaxCodesController, TaxCodesService } from './tax-codes';
import { BankAccountsController, BankAccountsService } from './bank-accounts';
import { PriceListsController, PriceListsService } from './price-lists';
import {
  CurrenciesController,
  ExchangeRatesController,
  ExchangeRatesService,
} from './currencies';

@Module({
  controllers: [
    CustomersController,
    SuppliersController,
    EmployeesController,
    ProductCategoriesController,
    BrandsController,
    UomsController,
    ProductsController,
    SalespersonsController,
    ProjectsController,
    PaymentTermsController,
    TaxCodesController,
    BankAccountsController,
    PriceListsController,
    CurrenciesController,
    ExchangeRatesController,
  ],
  providers: [
    CustomersService,
    SuppliersService,
    EmployeesService,
    ProductCategoriesService,
    BrandsService,
    UomsService,
    ProductsService,
    SalespersonsService,
    ProjectsService,
    PaymentTermsService,
    TaxCodesService,
    BankAccountsService,
    PriceListsService,
    ExchangeRatesService,
  ],
  exports: [ProductsService, TaxCodesService, BankAccountsService],
})
export class MasterdataModule {}
