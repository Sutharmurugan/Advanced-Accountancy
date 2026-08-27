/*
  Warnings:

  - Made the column `branch_id` on table `gl_account_balances` required. This step will fail if there are existing NULL values in that column.
  - Made the column `department_id` on table `gl_account_balances` required. This step will fail if there are existing NULL values in that column.
  - Made the column `cost_centre_id` on table `gl_account_balances` required. This step will fail if there are existing NULL values in that column.
  - Made the column `profit_centre_id` on table `gl_account_balances` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "gl_account_balances" ALTER COLUMN "branch_id" SET NOT NULL,
ALTER COLUMN "branch_id" SET DEFAULT '',
ALTER COLUMN "department_id" SET NOT NULL,
ALTER COLUMN "department_id" SET DEFAULT '',
ALTER COLUMN "cost_centre_id" SET NOT NULL,
ALTER COLUMN "cost_centre_id" SET DEFAULT '',
ALTER COLUMN "profit_centre_id" SET NOT NULL,
ALTER COLUMN "profit_centre_id" SET DEFAULT '';
