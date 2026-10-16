import { prisma } from "@/lib/prisma";
import { campaignContentHash, campaignDraftProblem, campaignSnapshot, pausedCampaignReadiness, type CampaignRequest } from "@/lib/publishing/campaigns";
import { readPublishingEnv } from "@/lib/publishing/config";
import { presentConnection } from "@/lib/publishing/connections";
import { loadSavedDraft, toSecret } from "@/lib/publishing/connection-store";
import { parseSavedDraft } from "@/lib/publishing/content";
import { assertPausedGoogleCampaign, googleAdsPausedMutations } from "@/lib/publishing/providers/google-ads";
import { assertPausedMetaCampaign, metaPausedCampaignBody } from "@/lib/publishing/providers/meta-ads";
import { readProviderJson, stringField } from "@/lib/publishing/redact";

export async function saveCampaignDraft(orgId: string, request: CampaignRequest) {
  const saved = await loadSavedDraft(orgId, request.sourceDraftId);
  if (!saved || saved.jobId !== request.jobId) return { error: "That saved draft is not available for this job.", status: 404 as const };
  const draft = parseSavedDraft(saved.metadata);
  if (!draft) return { error: "The saved draft could not be read. Save it again from the marketing page.", status: 400 as const };
  const problem = campaignDraftProblem(request, draft, new Date());
  if (problem) return { error: problem, status: 400 as const };
  const job = await prisma.job.findFirst({ where: { id: request.jobId, orgId }, select: { id: true } });
  if (!job) return { error: "That job is not available.", status: 404 as const };
  const snapshot = campaignSnapshot(request, draft);
  const row = await prisma.marketingCampaignDraft.create({
    data: {
      orgId,
      jobId: request.jobId,
      sourceDraftId: request.sourceDraftId,
      provider: request.provider,
      accountExternalId: request.accountExternalId,
      destinationUrl: request.destinationUrl,
      serviceArea: request.serviceArea,
      objective: request.objective,
      budgetAmountCents: request.budgetAmountCents,
      currency: "USD",
      scheduleStart: new Date(request.scheduleStart),
      scheduleEnd: new Date(request.scheduleEnd),
      contentSnapshot: snapshot,
      contentHash: campaignContentHash(snapshot),
      status: "DRAFT",
    },
  });
  return { campaign: publicCampaign(row) };
}

export async function approveCampaign(orgId: string, userId: string, campaignId: string, contentHash: string) {
  const row = await prisma.marketingCampaignDraft.findFirst({ where: { id: campaignId, orgId } });
  if (!row) return { error: "That campaign draft is not available.", status: 404 as const };
  if (row.contentHash !== contentHash) return { error: "The campaign changed. Review it again before approving.", status: 409 as const };
  const updated = await prisma.marketingCampaignDraft.update({
    where: { id: row.id },
    data: { status: "APPROVED", approvedAt: new Date(), approvedById: userId, missingStep: null },
  });
  return { campaign: publicCampaign(updated) };
}

export async function createPausedCampaign(orgId: string, campaignId: string) {
  const row = await prisma.marketingCampaignDraft.findFirst({ where: { id: campaignId, orgId } });
  if (!row) return { error: "That campaign draft is not available.", status: 404 as const };
  if (row.provider !== "GOOGLE_ADS" && row.provider !== "META_ADS") {
    return { error: "Choose Google Ads or Meta Ads.", status: 400 as const };
  }
  const connection = await prisma.marketingConnection.findUnique({ where: { orgId_provider: { orgId, provider: row.provider } } });
  const secret = connection ? toSecret(connection) : null;
  const presented = presentConnection(row.provider, secret, readPublishingEnv(process.env), new Date());
  const readiness = pausedCampaignReadiness({
    presented,
    provider: row.provider,
    status: row.status,
    approvedHash: row.contentHash,
    currentHash: row.contentHash,
    scheduleEnd: row.scheduleEnd,
    now: new Date(),
  });
  if (!readiness.ok) {
    const blocked = await prisma.marketingCampaignDraft.update({
      where: { id: row.id },
      data: { status: row.status === "APPROVED" ? "BLOCKED" : row.status, missingStep: readiness.missingStep },
    });
    return { campaign: publicCampaign(blocked), created: false as const };
  }
  if (readPublishingEnv(process.env).publishMode !== "live") {
    return {
      campaign: publicCampaign(row),
      created: false as const,
      message: "Publishing mode is mock. The approved campaign stays in this app, and nothing was created in the ad account.",
    };
  }
  if (!secret?.accessToken) return { error: presented.note, status: 409 as const };
  const name = `RHI Pros · ${row.objective === "QUOTE_REQUESTS" ? "Quote requests" : "Website visits"} · ${row.serviceArea}`.slice(0, 120);
  try {
    const platformId =
      row.provider === "GOOGLE_ADS"
        ? await createGooglePaused({
            customerId: row.accountExternalId,
            accessToken: secret.accessToken,
            name,
            budgetAmountCents: row.budgetAmountCents,
            scheduleStart: row.scheduleStart,
            scheduleEnd: row.scheduleEnd,
          })
        : await createMetaPaused({ adAccountId: row.accountExternalId, name, accessToken: secret.accessToken });
    const updated = await prisma.marketingCampaignDraft.update({
      where: { id: row.id },
      data: { status: "PAUSED_ON_PLATFORM", platformCampaignId: platformId, missingStep: "Paused only. This app will not enable the campaign or change its budget." },
    });
    return { campaign: publicCampaign(updated), created: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "The ad account did not accept the paused campaign.";
    const blocked = await prisma.marketingCampaignDraft.update({
      where: { id: row.id },
      data: { status: "BLOCKED", missingStep: message },
    });
    return { campaign: publicCampaign(blocked), created: false as const };
  }
}

async function createGooglePaused(input: {
  customerId: string;
  accessToken: string;
  name: string;
  budgetAmountCents: number;
  scheduleStart: Date;
  scheduleEnd: Date;
}) {
  const version = readPublishingEnv(process.env).googleAdsVersion;
  const budgetBody = googleAdsPausedMutations({
    customerId: input.customerId,
    name: input.name,
    budgetAmountCents: input.budgetAmountCents,
    startDate: input.scheduleStart.toISOString().slice(0, 10),
    endDate: input.scheduleEnd.toISOString().slice(0, 10),
    budgetResourceName: "pending",
  }).budget;
  const headers: Record<string, string> = { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" };
  const loginCustomer = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replaceAll("-", "").trim();
  if (loginCustomer) headers["login-customer-id"] = loginCustomer;
  const budgetResponse = await fetch(`https://googleads.googleapis.com/${version}/customers/${input.customerId}/campaignBudgets:mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify(budgetBody),
  });
  const budgetPayload = await readProviderJson(budgetResponse);
  if (!budgetResponse.ok) throw new Error("Google Ads did not accept the paused budget.");
  const budgetName = findResourceName(budgetPayload);
  if (!budgetName) throw new Error("Google Ads did not return a budget.");
  const campaign = googleAdsPausedMutations({
    customerId: input.customerId,
    name: input.name,
    budgetAmountCents: input.budgetAmountCents,
    startDate: input.scheduleStart.toISOString().slice(0, 10),
    endDate: input.scheduleEnd.toISOString().slice(0, 10),
    budgetResourceName: budgetName,
  }).campaign;
  assertPausedGoogleCampaign(campaign);
  const response = await fetch(`https://googleads.googleapis.com/${version}/customers/${input.customerId}/campaigns:mutate`, {
    method: "POST",
    headers,
    body: JSON.stringify(campaign),
  });
  const payload = await readProviderJson(response);
  if (!response.ok) throw new Error("Google Ads did not accept the paused campaign.");
  const id = findResourceName(payload);
  if (!id) throw new Error("Google Ads did not return a campaign id.");
  return id;
}

async function createMetaPaused(input: { adAccountId: string; accessToken: string; name: string }) {
  const body = metaPausedCampaignBody({ name: input.name });
  assertPausedMetaCampaign(body);
  const version = readPublishingEnv(process.env).graphVersion;
  const response = await fetch(`https://graph.facebook.com/${version}/${input.adAccountId}/campaigns`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await readProviderJson(response);
  if (!response.ok) throw new Error("Meta Ads did not accept the paused campaign.");
  const id = stringField(payload, "id");
  if (!id) throw new Error("Meta Ads did not return a campaign id.");
  return id;
}

function findResourceName(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const results = "results" in payload && Array.isArray((payload as { results?: unknown }).results) ? (payload as { results: unknown[] }).results : [];
  for (const result of results) {
    const name = result && typeof result === "object" ? stringField(result, "resourceName") : null;
    if (name) return name;
  }
  return stringField(payload, "resourceName");
}

function publicCampaign(row: {
  id: string;
  provider: string;
  status: string;
  accountExternalId: string;
  destinationUrl: string;
  serviceArea: string;
  objective: string;
  budgetAmountCents: number;
  currency: string;
  scheduleStart: Date;
  scheduleEnd: Date;
  contentHash: string;
  platformCampaignId: string | null;
  missingStep: string | null;
  contentSnapshot: unknown;
}) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    accountExternalId: row.accountExternalId,
    destinationUrl: row.destinationUrl,
    serviceArea: row.serviceArea,
    objective: row.objective,
    budgetAmountCents: row.budgetAmountCents,
    currency: row.currency,
    scheduleStart: row.scheduleStart.toISOString(),
    scheduleEnd: row.scheduleEnd.toISOString(),
    contentHash: row.contentHash,
    platformCampaignId: row.platformCampaignId,
    missingStep: row.missingStep,
    name: `${row.objective === "QUOTE_REQUESTS" ? "Quote requests" : "Website visits"} · ${row.serviceArea}`.slice(0, 120),
  };
}

export async function listCampaignDrafts(orgId: string) {
  const rows = await prisma.marketingCampaignDraft.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, take: 12 });
  return rows.map(publicCampaign);
}
