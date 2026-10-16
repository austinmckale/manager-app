-- Marketing connections, per-destination deliveries, ingest media, weekly reports, and ad campaign drafts.
-- Do not apply this migration to production as part of the publishing task.

-- CreateEnum
CREATE TYPE "MarketingProvider" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM', 'GOOGLE_BUSINESS', 'GOOGLE_ADS', 'META_ADS');

-- CreateEnum
CREATE TYPE "MarketingConnectionStatus" AS ENUM ('MISSING_CONFIGURATION', 'PENDING_PLATFORM_APPROVAL', 'CONNECTED', 'EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "MarketingDeliveryStatus" AS ENUM ('ACCEPTED', 'PROCESSING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'APPROVED', 'BLOCKED', 'PAUSED_ON_PLATFORM');

-- CreateTable
CREATE TABLE "MarketingConnection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orgId" UUID NOT NULL,
    "provider" "MarketingProvider" NOT NULL,
    "status" "MarketingConnectionStatus" NOT NULL DEFAULT 'MISSING_CONFIGURATION',
    "externalAccountId" TEXT,
    "externalAccountName" TEXT,
    "scopes" TEXT[],
    "accessTokenCipher" TEXT,
    "refreshTokenCipher" TEXT,
    "accountCatalogCipher" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastError" TEXT,
    "approvalNote" TEXT,
    "metadata" JSONB,
    "connectedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingDelivery" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "draftId" UUID NOT NULL,
    "destination" "MarketingProvider" NOT NULL,
    "assetIds" TEXT[],
    "idempotencyKey" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "MarketingDeliveryStatus" NOT NULL,
    "providerPostId" TEXT,
    "containerId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingIngestMedia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orgId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "deliveryId" UUID,
    "publicPath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingIngestMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingReportRun" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orgId" UUID NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "preview" JSONB NOT NULL,
    "sendStatus" TEXT NOT NULL,
    "recipient" TEXT,
    "channel" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingReportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaignDraft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "orgId" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "sourceDraftId" UUID NOT NULL,
    "provider" "MarketingProvider" NOT NULL,
    "accountExternalId" TEXT NOT NULL,
    "destinationUrl" TEXT NOT NULL,
    "serviceArea" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "budgetAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "scheduleStart" TIMESTAMP(3) NOT NULL,
    "scheduleEnd" TIMESTAMP(3) NOT NULL,
    "contentSnapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedAt" TIMESTAMP(3),
    "approvedById" UUID,
    "platformCampaignId" TEXT,
    "missingStep" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaignDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingConnection_orgId_provider_key" ON "MarketingConnection"("orgId", "provider");
CREATE INDEX "MarketingConnection_orgId_idx" ON "MarketingConnection"("orgId");
CREATE UNIQUE INDEX "MarketingDelivery_orgId_idempotencyKey_key" ON "MarketingDelivery"("orgId", "idempotencyKey");
CREATE INDEX "MarketingDelivery_orgId_createdAt_idx" ON "MarketingDelivery"("orgId", "createdAt");
CREATE INDEX "MarketingDelivery_orgId_jobId_idx" ON "MarketingDelivery"("orgId", "jobId");
CREATE INDEX "MarketingDelivery_orgId_status_idx" ON "MarketingDelivery"("orgId", "status");
CREATE INDEX "MarketingDelivery_draftId_idx" ON "MarketingDelivery"("draftId");
CREATE INDEX "MarketingIngestMedia_orgId_idx" ON "MarketingIngestMedia"("orgId");
CREATE INDEX "MarketingIngestMedia_expiresAt_idx" ON "MarketingIngestMedia"("expiresAt");
CREATE INDEX "MarketingIngestMedia_deliveryId_idx" ON "MarketingIngestMedia"("deliveryId");
CREATE UNIQUE INDEX "MarketingReportRun_orgId_weekStart_key" ON "MarketingReportRun"("orgId", "weekStart");
CREATE INDEX "MarketingReportRun_orgId_idx" ON "MarketingReportRun"("orgId");
CREATE INDEX "MarketingCampaignDraft_orgId_provider_idx" ON "MarketingCampaignDraft"("orgId", "provider");
CREATE INDEX "MarketingCampaignDraft_orgId_createdAt_idx" ON "MarketingCampaignDraft"("orgId", "createdAt");
CREATE INDEX "MarketingCampaignDraft_sourceDraftId_idx" ON "MarketingCampaignDraft"("sourceDraftId");

-- AddForeignKey
ALTER TABLE "MarketingConnection" ADD CONSTRAINT "MarketingConnection_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingDelivery" ADD CONSTRAINT "MarketingDelivery_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingDelivery" ADD CONSTRAINT "MarketingDelivery_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingIngestMedia" ADD CONSTRAINT "MarketingIngestMedia_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingReportRun" ADD CONSTRAINT "MarketingReportRun_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingCampaignDraft" ADD CONSTRAINT "MarketingCampaignDraft_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingCampaignDraft" ADD CONSTRAINT "MarketingCampaignDraft_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
