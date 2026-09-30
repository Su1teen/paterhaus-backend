-- AddColumn Campaign fields
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "objective" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "targetAudienceJson" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "adCreativeUrl" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "impressions" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "clicks" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "reach" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "conversions" INTEGER;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "dailyBudget" DECIMAL(12,2);
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "lifetimeBudget" DECIMAL(12,2);
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "bidStrategy" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "externalCampaignId" TEXT;

-- CreateTable MarketingLeadEntry
CREATE TABLE IF NOT EXISTS "MarketingLeadEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "entryDate" TIMESTAMP(3) NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "propertyType" TEXT,
    "service" TEXT,
    "firstFollowUp" TEXT,
    "secondFollowUp" TEXT,
    "comments" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "campaignId" UUID,
    CONSTRAINT "MarketingLeadEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MarketingLeadEntry_entryDate_idx" ON "MarketingLeadEntry"("entryDate");
CREATE INDEX IF NOT EXISTS "MarketingLeadEntry_service_idx" ON "MarketingLeadEntry"("service");
CREATE INDEX IF NOT EXISTS "MarketingLeadEntry_archivedAt_idx" ON "MarketingLeadEntry"("archivedAt");
CREATE INDEX IF NOT EXISTS "MarketingLeadEntry_campaignId_idx" ON "MarketingLeadEntry"("campaignId");

ALTER TABLE "MarketingLeadEntry" ADD CONSTRAINT "MarketingLeadEntry_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
