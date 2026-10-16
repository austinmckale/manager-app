import { z } from "zod";
import { ORGANIC_DESTINATIONS } from "@/lib/publishing/types";

export const publishRequestSchema = z
  .object({
    jobId: z.string().uuid(),
    draftId: z.string().uuid(),
    assetIds: z.array(z.string().uuid()).min(1).max(10),
    destinations: z.array(z.enum(ORGANIC_DESTINATIONS)).min(1).max(3),
  })
  .strict();

export const retryRequestSchema = z.object({ deliveryId: z.string().uuid() }).strict();

export const disconnectRequestSchema = z
  .object({
    provider: z.enum(["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS", "GOOGLE_ADS", "META_ADS"]),
  })
  .strict();

export const selectAccountSchema = z
  .object({
    provider: z.enum(["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS", "GOOGLE_ADS", "META_ADS"]),
    externalAccountId: z.string().min(1).max(200),
  })
  .strict();

export const approveCampaignSchema = z.object({ campaignId: z.string().uuid(), contentHash: z.string().length(64) }).strict();
export const createPausedCampaignSchema = z.object({ campaignId: z.string().uuid() }).strict();
