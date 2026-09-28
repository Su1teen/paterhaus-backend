CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED');
CREATE TYPE "ProjectPaymentType" AS ENUM ('PREPAYMENT', 'PARTIAL', 'FINAL', 'REFUND', 'OTHER');
CREATE TYPE "ProjectPaymentStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED');

ALTER TABLE "Campaign" ADD COLUMN "spendAmount" DECIMAL(12,2), ADD COLUMN "currency" TEXT, ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "Lead" ADD COLUMN "externalChatId" TEXT, ADD COLUMN "archivedAt" TIMESTAMP(3), ADD COLUMN "priority" TEXT, ADD COLUMN "nextActionType" TEXT, ADD COLUMN "nextActionText" TEXT, ADD COLUMN "nextActionAt" TIMESTAMP(3), ADD COLUMN "note" TEXT, ADD COLUMN "quotedAmount" DECIMAL(14,2), ADD COLUMN "agreedAmount" DECIMAL(14,2), ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'AED';
CREATE UNIQUE INDEX "Lead_externalChatId_key" ON "Lead"("externalChatId");
CREATE INDEX "Lead_archivedAt_idx" ON "Lead"("archivedAt");

CREATE TABLE "Property" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "address" TEXT, "area" TEXT, "type" TEXT, "unit" TEXT,
  "bedrooms" INTEGER, "bathrooms" INTEGER, "ownerLeadId" UUID, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT, "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ServiceProject" (
  "id" UUID NOT NULL, "propertyId" UUID, "ownerLeadId" UUID, "sourceOpportunityId" UUID,
  "name" TEXT NOT NULL, "serviceDirections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT', "quotedAmount" DECIMAL(14,2),
  "agreedAmount" DECIMAL(14,2), "currency" TEXT NOT NULL DEFAULT 'AED', "startDate" TIMESTAMP(3),
  "expectedCompletionDate" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3), "comment" TEXT,
  "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "ServiceProject_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectMilestone" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "title" TEXT NOT NULL, "sortOrder" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3), "comment" TEXT, "responsible" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectPayment" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "amount" DECIMAL(14,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AED', "type" "ProjectPaymentType" NOT NULL,
  "status" "ProjectPaymentStatus" NOT NULL DEFAULT 'PENDING', "paidAt" TIMESTAMP(3), "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectPayment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Contractor" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "contactPerson" TEXT, "phone" TEXT, "email" TEXT,
  "notes" TEXT, "active" BOOLEAN NOT NULL DEFAULT true, "serviceTypes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contractor_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectContractorAssignment" (
  "id" UUID NOT NULL, "projectId" UUID NOT NULL, "contractorId" UUID NOT NULL, "scope" TEXT,
  "amount" DECIMAL(14,2), "currency" TEXT NOT NULL DEFAULT 'AED', "status" TEXT,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" TIMESTAMP(3), "note" TEXT,
  CONSTRAINT "ProjectContractorAssignment_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Guest" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "phone" TEXT, "email" TEXT, "nationality" TEXT,
  "notes" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "Guest_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Stay" (
  "id" UUID NOT NULL, "propertyId" UUID NOT NULL, "guestId" UUID NOT NULL, "source" TEXT,
  "checkIn" TIMESTAMP(3) NOT NULL, "checkOut" TIMESTAMP(3) NOT NULL, "guestCount" INTEGER NOT NULL DEFAULT 1,
  "bookingValue" DECIMAL(14,2), "currency" TEXT NOT NULL DEFAULT 'AED',
  "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID', "status" TEXT NOT NULL DEFAULT 'BOOKED', "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Stay_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InternalDocument" (
  "id" UUID NOT NULL, "title" TEXT NOT NULL, "originalFileName" TEXT NOT NULL, "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL, "storageKey" TEXT NOT NULL, "category" TEXT NOT NULL,
  "description" TEXT, "uploadedBy" TEXT NOT NULL, "propertyId" UUID, "projectId" UUID,
  "contractorId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "InternalDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Property_ownerLeadId_idx" ON "Property"("ownerLeadId");
CREATE INDEX "Property_archivedAt_idx" ON "Property"("archivedAt");
CREATE INDEX "ServiceProject_propertyId_idx" ON "ServiceProject"("propertyId");
CREATE INDEX "ServiceProject_ownerLeadId_idx" ON "ServiceProject"("ownerLeadId");
CREATE INDEX "ServiceProject_sourceOpportunityId_idx" ON "ServiceProject"("sourceOpportunityId");
CREATE INDEX "ServiceProject_status_archivedAt_idx" ON "ServiceProject"("status", "archivedAt");
CREATE INDEX "ProjectMilestone_projectId_sortOrder_idx" ON "ProjectMilestone"("projectId", "sortOrder");
CREATE INDEX "ProjectPayment_projectId_status_idx" ON "ProjectPayment"("projectId", "status");
CREATE INDEX "ProjectPayment_paidAt_idx" ON "ProjectPayment"("paidAt");
CREATE UNIQUE INDEX "ProjectContractorAssignment_projectId_contractorId_key" ON "ProjectContractorAssignment"("projectId", "contractorId");
CREATE INDEX "ProjectContractorAssignment_contractorId_idx" ON "ProjectContractorAssignment"("contractorId");
CREATE INDEX "Stay_propertyId_checkIn_idx" ON "Stay"("propertyId", "checkIn");
CREATE INDEX "Stay_guestId_idx" ON "Stay"("guestId");
CREATE INDEX "Stay_status_checkIn_idx" ON "Stay"("status", "checkIn");
CREATE UNIQUE INDEX "InternalDocument_storageKey_key" ON "InternalDocument"("storageKey");
CREATE INDEX "InternalDocument_category_createdAt_idx" ON "InternalDocument"("category", "createdAt");

ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerLeadId_fkey" FOREIGN KEY ("ownerLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceProject" ADD CONSTRAINT "ServiceProject_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceProject" ADD CONSTRAINT "ServiceProject_ownerLeadId_fkey" FOREIGN KEY ("ownerLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceProject" ADD CONSTRAINT "ServiceProject_sourceOpportunityId_fkey" FOREIGN KEY ("sourceOpportunityId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ServiceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectPayment" ADD CONSTRAINT "ProjectPayment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ServiceProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectContractorAssignment" ADD CONSTRAINT "ProjectContractorAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ServiceProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectContractorAssignment" ADD CONSTRAINT "ProjectContractorAssignment_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Stay" ADD CONSTRAINT "Stay_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "Guest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalDocument" ADD CONSTRAINT "InternalDocument_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalDocument" ADD CONSTRAINT "InternalDocument_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ServiceProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalDocument" ADD CONSTRAINT "InternalDocument_contractorId_fkey" FOREIGN KEY ("contractorId") REFERENCES "Contractor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
