-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MARKETING', 'OWNER_ACQUISITION', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "CampaignPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'GOOGLE', 'WHATSAPP', 'REFERRAL', 'OTHER');

-- CreateEnum
CREATE TYPE "CampaignDirection" AS ENUM ('PROPERTY_MANAGEMENT', 'SNAGGING', 'STAGING');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "LeadDirection" AS ENUM ('UNCLASSIFIED', 'PROPERTY_MANAGEMENT', 'SNAGGING', 'STAGING');

-- CreateEnum
CREATE TYPE "LeadSource" AS ENUM ('META_CONNECTOR', 'META_LEAD_ADS', 'WHATSAPP', 'WEBSITE', 'REFERRAL', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MappingStatus" AS ENUM ('MAPPED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "LeadEventType" AS ENUM ('LEAD_CREATED', 'WEBHOOK_RECEIVED', 'STAGE_CHANGED', 'ASSIGNED', 'NOTE_ADDED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MAPPING_REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'DUPLICATE', 'NEEDS_REVIEW', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "platform" "CampaignPlatform" NOT NULL,
    "direction" "CampaignDirection" NOT NULL,
    "status" "CampaignStatus" NOT NULL,
    "spendUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" UUID NOT NULL,
    "externalLeadId" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "normalizedPhone" TEXT,
    "email" TEXT,
    "normalizedEmail" TEXT,
    "propertyType" TEXT,
    "propertyArea" TEXT,
    "bedrooms" INTEGER,
    "serviceRaw" TEXT,
    "direction" "LeadDirection" NOT NULL DEFAULT 'UNCLASSIFIED',
    "stage" TEXT NOT NULL DEFAULT 'new',
    "source" "LeadSource" NOT NULL,
    "mappingStatus" "MappingStatus" NOT NULL DEFAULT 'MAPPED',
    "campaignId" UUID,
    "assignedUserId" UUID,
    "firstResponseAt" TIMESTAMP(3),
    "firstResponseDueAt" TIMESTAMP(3),
    "followUpDueAt" TIMESTAMP(3),
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadAttribution" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "platform" TEXT,
    "campaignExternalId" TEXT,
    "campaignName" TEXT,
    "adSetExternalId" TEXT,
    "adSetName" TEXT,
    "adExternalId" TEXT,
    "adName" TEXT,
    "formExternalId" TEXT,
    "formName" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "firstTouchAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadEvent" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "type" "LeadEventType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT,
    "externalLeadId" TEXT,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "errorMessage" TEXT,
    "leadId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationMapping" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceField" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "targetField" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Campaign_direction_idx" ON "Campaign"("direction");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_platform_idx" ON "Campaign"("platform");

-- CreateIndex
CREATE INDEX "Lead_externalLeadId_idx" ON "Lead"("externalLeadId");

-- CreateIndex
CREATE INDEX "Lead_normalizedPhone_idx" ON "Lead"("normalizedPhone");

-- CreateIndex
CREATE INDEX "Lead_normalizedEmail_idx" ON "Lead"("normalizedEmail");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_direction_idx" ON "Lead"("direction");

-- CreateIndex
CREATE INDEX "Lead_stage_idx" ON "Lead"("stage");

-- CreateIndex
CREATE INDEX "Lead_source_idx" ON "Lead"("source");

-- CreateIndex
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");

-- CreateIndex
CREATE INDEX "Lead_mappingStatus_idx" ON "Lead"("mappingStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_source_externalLeadId_key" ON "Lead"("source", "externalLeadId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadAttribution_leadId_key" ON "LeadAttribution"("leadId");

-- CreateIndex
CREATE INDEX "LeadEvent_leadId_idx" ON "LeadEvent"("leadId");

-- CreateIndex
CREATE INDEX "LeadEvent_type_idx" ON "LeadEvent"("type");

-- CreateIndex
CREATE INDEX "LeadEvent_occurredAt_idx" ON "LeadEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_idx" ON "WebhookEvent"("provider");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_idx" ON "WebhookEvent"("status");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_externalLeadId_idx" ON "WebhookEvent"("externalLeadId");

-- CreateIndex
CREATE INDEX "IntegrationMapping_provider_idx" ON "IntegrationMapping"("provider");

-- CreateIndex
CREATE INDEX "IntegrationMapping_active_idx" ON "IntegrationMapping"("active");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationMapping_provider_sourceField_sourceValue_targetF_key" ON "IntegrationMapping"("provider", "sourceField", "sourceValue", "targetField");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadAttribution" ADD CONSTRAINT "LeadAttribution_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadEvent" ADD CONSTRAINT "LeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
