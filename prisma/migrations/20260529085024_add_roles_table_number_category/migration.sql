-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "UserRole" ADD VALUE 'Hotel_Manager';
ALTER TYPE "UserRole" ADD VALUE 'Hotel_Receptionist';
ALTER TYPE "UserRole" ADD VALUE 'Hotel_Housekeeping';
ALTER TYPE "UserRole" ADD VALUE 'Kiosk_Cashier';
ALTER TYPE "UserRole" ADD VALUE 'Restaurant_Admin';
ALTER TYPE "UserRole" ADD VALUE 'Restaurant_Manager';
ALTER TYPE "UserRole" ADD VALUE 'Restaurant_Waiter';
ALTER TYPE "UserRole" ADD VALUE 'Restaurant_Chef';
ALTER TYPE "UserRole" ADD VALUE 'Restaurant_Cashier';
ALTER TYPE "UserRole" ADD VALUE 'Retail_Admin';
ALTER TYPE "UserRole" ADD VALUE 'Retail_Manager';
ALTER TYPE "UserRole" ADD VALUE 'Retail_Cashier';
ALTER TYPE "UserRole" ADD VALUE 'Retail_Sales_Associate';
ALTER TYPE "UserRole" ADD VALUE 'Hospital_Doctor';
ALTER TYPE "UserRole" ADD VALUE 'Hospital_Nurse';
ALTER TYPE "UserRole" ADD VALUE 'Hospital_Receptionist';
ALTER TYPE "UserRole" ADD VALUE 'Hospital_Pharmacist';
ALTER TYPE "UserRole" ADD VALUE 'Hospital_Labtechnician';

-- AlterTable
ALTER TABLE "transaction_items" ADD COLUMN     "category" TEXT,
ALTER COLUMN "productId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "tableNumber" TEXT;
