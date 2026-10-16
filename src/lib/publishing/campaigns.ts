import { createHash } from "node:crypto";
import { z } from "zod";
import type { MarketingDraft } from "@/lib/marketing";
import type { PresentedConnection } from "@/lib/publishing/connections";
import type { AdProvider } from "@/lib/publishing/types";

const isoTimestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);

export const campaignRequestSchema = z
  .object({
    provider: z.enum(["GOOGLE_ADS", "META_ADS"]),
    jobId: z.string().uuid(),
    sourceDraftId: z.string().uuid(),
    accountExternalId: z.string().min(3).max(160),
    destinationUrl: z.string().url().startsWith("https://").max(500),
    serviceArea: z.string().trim().min(2).max(120),
    objective: z.enum(["WEBSITE_VISITS", "QUOTE_REQUESTS"]),
    budgetAmountCents: z.number().int().positive().max(10_000_000),
    currency: z.literal("USD"),
    scheduleStart: isoTimestamp,
    scheduleEnd: isoTimestamp,
  })
  .strict();

export type CampaignRequest = z.infer<typeof campaignRequestSchema>;

export type CampaignSnapshot = CampaignRequest & {
  social: string;
  googleHeadlines: string[];
  googleDescriptions: string[];
  metaPrimary: string;
  metaHeadline: string;
};

export function campaignSnapshot(request: CampaignRequest, draft: MarketingDraft): CampaignSnapshot {
  return {
    ...request,
    social: draft.social,
    googleHeadlines: draft.googleHeadlines,
    googleDescriptions: draft.googleDescriptions,
    metaPrimary: draft.metaPrimary,
    metaHeadline: draft.metaHeadline,
  };
}

export function campaignContentHash(snapshot: CampaignSnapshot) {
  return createHash("sha256").update(stable(snapshot)).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stable(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function accountProblem(provider: AdProvider, accountExternalId: string) {
  if (provider === "GOOGLE_ADS" && !/^\d{10}$/.test(accountExternalId)) {
    return "Enter the 10-digit Google Ads customer ID, without hyphens.";
  }
  if (provider === "META_ADS" && !/^act_\d+$/.test(accountExternalId)) {
    return "Choose a Meta ad account id that starts with act_.";
  }
  return null;
}

export function campaignDraftProblem(request: CampaignRequest, draft: MarketingDraft, now: Date) {
  if (request.destinationUrl !== draft.landingUrl) {
    return "The destination URL has to match the landing URL saved on the draft.";
  }
  const account = accountProblem(request.provider, request.accountExternalId);
  if (account) return account;
  const start = Date.parse(request.scheduleStart);
  const end = Date.parse(request.scheduleEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "The schedule end has to be after the schedule start.";
  }
  if (end <= now.getTime()) return "The schedule has already ended.";
  return null;
}

export function pausedCampaignReadiness(input: {
  presented: PresentedConnection;
  provider: AdProvider;
  status: "DRAFT" | "APPROVED" | "BLOCKED" | "PAUSED_ON_PLATFORM";
  approvedHash: string;
  currentHash: string;
  scheduleEnd: Date;
  now: Date;
}) {
  if (input.status === "PAUSED_ON_PLATFORM") {
    return { ok: false as const, missingStep: "A paused campaign already exists for this draft. This app will not enable it or change its budget." };
  }
  if (input.status !== "APPROVED") {
    return { ok: false as const, missingStep: "Approve the exact campaign before any campaign is created in the ad account." };
  }
  if (input.approvedHash !== input.currentHash) {
    return { ok: false as const, missingStep: "The campaign changed after approval. Save and approve it again." };
  }
  if (input.scheduleEnd.getTime() <= input.now.getTime()) {
    return { ok: false as const, missingStep: "The schedule has already ended, so no campaign was created." };
  }
  if (input.presented.provider !== input.provider || input.presented.status !== "CONNECTED") {
    return { ok: false as const, missingStep: input.presented.note };
  }
  return { ok: true as const };
}

export function campaignName(snapshot: CampaignSnapshot) {
  const objective = snapshot.objective === "QUOTE_REQUESTS" ? "Quote requests" : "Website visits";
  return `RHI Pros · ${objective} · ${snapshot.serviceArea}`.slice(0, 120);
}
