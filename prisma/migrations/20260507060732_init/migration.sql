-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Super_Admin', 'Biztrack_ADMIN', 'Hotel_Admin', 'Hotel_Cashier', 'Hotel_Waiter', 'Kiosk_Admin', 'Kiosk_Shopkeeper', 'Hospital_Admin', 'Doctor', 'Nurse', 'Lab_Technician', 'Receptionist', 'Pharmacist', 'Staff');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "OtpType" AS ENUM ('login', 'reset', 'verification');

-- CreateEnum
CREATE TYPE "OtpStatus" AS ENUM ('pending', 'consumed', 'expired', 'revoked');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('TILL', 'PAYBILL', 'POCHI');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'Kiosk_Shopkeeper',
    "businessName" TEXT,
    "associatedBusinessId" TEXT,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "permissions" TEXT[] DEFAULT ARRAY['read', 'write', 'delete']::TEXT[],
    "lastLogin" TEXT NOT NULL DEFAULT 'Never',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "businessId" INTEGER NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "logoUrl" TEXT NOT NULL DEFAULT '',
    "primaryColor" TEXT NOT NULL DEFAULT '#000000',
    "status" TEXT NOT NULL DEFAULT 'active',
    "paymentType" "PaymentType" NOT NULL DEFAULT 'TILL',
    "tillNumber" TEXT,
    "paybillNumber" TEXT,
    "accountNumber" TEXT,
    "pochiNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otps" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "originalOtp" TEXT NOT NULL,
    "maskedOtp" TEXT,
    "type" "OtpType" NOT NULL DEFAULT 'login',
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "OtpStatus" NOT NULL DEFAULT 'pending',
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL,
    "buyingPrice" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "status" TEXT NOT NULL DEFAULT 'Out of Stock',
    "description" TEXT NOT NULL DEFAULT '',
    "businessId" INTEGER NOT NULL,
    "businessUUID" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_items" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'units',
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "transaction_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessUUID" TEXT NOT NULL,
    "businessName" TEXT,
    "businessType" TEXT,
    "shopkeeperId" TEXT NOT NULL,
    "shopkeeperName" TEXT NOT NULL,
    "shopkeeperEmail" TEXT,
    "shopkeeperPhone" TEXT,
    "shopkeeperRole" TEXT NOT NULL DEFAULT 'Kiosk_Shopkeeper',
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'sale',
    "paymentMethod" TEXT NOT NULL,
    "originalPaymentMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "change" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "customerPhone" TEXT,
    "mpesaReceipt" TEXT,
    "checkoutRequestId" TEXT,
    "merchantRequestId" TEXT,
    "customerName" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "debtPaid" BOOLEAN NOT NULL DEFAULT false,
    "debtPaymentMethod" TEXT,
    "debtPaymentDate" TIMESTAMP(3),
    "datePaid" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "paymentDetails" JSONB NOT NULL DEFAULT '{}',
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_businessId_key" ON "businesses"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_registrationNumber_key" ON "businesses"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_businessName_key" ON "businesses"("businessName");

-- CreateIndex
CREATE INDEX "otps_email_idx" ON "otps"("email");

-- CreateIndex
CREATE INDEX "otps_userId_idx" ON "otps"("userId");

-- CreateIndex
CREATE INDEX "otps_expiresAt_idx" ON "otps"("expiresAt");

-- CreateIndex
CREATE INDEX "otps_createdAt_idx" ON "otps"("createdAt");

-- CreateIndex
CREATE INDEX "products_businessId_idx" ON "products"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_businessId_key" ON "products"("sku", "businessId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_transactionId_key" ON "transactions"("transactionId");

-- CreateIndex
CREATE INDEX "transactions_businessId_timestamp_idx" ON "transactions"("businessId", "timestamp");

-- CreateIndex
CREATE INDEX "transactions_shopkeeperId_timestamp_idx" ON "transactions"("shopkeeperId", "timestamp");

-- CreateIndex
CREATE INDEX "transactions_businessId_status_idx" ON "transactions"("businessId", "status");

-- CreateIndex
CREATE INDEX "transactions_businessId_paymentMethod_idx" ON "transactions"("businessId", "paymentMethod");

-- CreateIndex
CREATE INDEX "transactions_businessId_debtPaid_idx" ON "transactions"("businessId", "debtPaid");

-- CreateIndex
CREATE INDEX "transactions_checkoutRequestId_idx" ON "transactions"("checkoutRequestId");

-- AddForeignKey
ALTER TABLE "transaction_items" ADD CONSTRAINT "transaction_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
