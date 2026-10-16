import { NextResponse } from "next/server";
import { z } from "zod";
import { approveCampaign, createPausedCampaign, listCampaignDrafts, saveCampaignDraft } from "@/lib/publishing/campaign-actions";
import { campaignRequestSchema } from "@/lib/publishing/campaigns";
import { approveCampaignSchema, createPausedCampaignSchema } from "@/lib/publishing/api-schema";
import { authorizePublishing, isMissingRelation } from "@/lib/publishing/http";

const saveSchema = campaignRequestSchema.safeExtend({ action: z.literal("save") });
const approveSchema = approveCampaignSchema.safeExtend({ action: z.literal("approve") });
const pausedSchema = createPausedCampaignSchema.safeExtend({ action: z.literal("createPaused") });

export async function GET() {
  const authorized = await authorizePublishing();
  if ("response" in authorized) return authorized.response;
  try {
    return NextResponse.json({ campaigns: await listCampaignDrafts(authorized.auth.orgId) });
  } catch (error) {
    if (isMissingRelation(error)) return NextResponse.json({ campaigns: [], migrationReady: false });
    throw error;
  }
}

export async function POST(request: Request) {
  const authorized = await authorizePublishing(request);
  if ("response" in authorized) return authorized.response;
  const body = await request.json().catch(() => null);
  const action = body && typeof body === "object" && "action" in body ? (body as { action?: string }).action : "";
  try {
    if (action === "save") {
      const parsed = saveSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Check the account, URL, service area, objective, budget, and schedule." }, { status: 400 });
      const saved = await saveCampaignDraft(authorized.auth.orgId, {
        provider: parsed.data.provider,
        jobId: parsed.data.jobId,
        sourceDraftId: parsed.data.sourceDraftId,
        accountExternalId: parsed.data.accountExternalId,
        destinationUrl: parsed.data.destinationUrl,
        serviceArea: parsed.data.serviceArea,
        objective: parsed.data.objective,
        budgetAmountCents: parsed.data.budgetAmountCents,
        currency: parsed.data.currency,
        scheduleStart: parsed.data.scheduleStart,
        scheduleEnd: parsed.data.scheduleEnd,
      });
      if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: saved.status });
      return NextResponse.json({ ok: true, campaign: saved.campaign });
    }
    if (action === "approve") {
      const parsed = approveSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Review the exact campaign before approving it." }, { status: 400 });
      const approved = await approveCampaign(authorized.auth.orgId, authorized.auth.userId, parsed.data.campaignId, parsed.data.contentHash);
      if ("error" in approved) return NextResponse.json({ error: approved.error }, { status: approved.status });
      return NextResponse.json({ ok: true, campaign: approved.campaign });
    }
    if (action === "createPaused") {
      const parsed = pausedSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: "Choose an approved campaign." }, { status: 400 });
      const created = await createPausedCampaign(authorized.auth.orgId, parsed.data.campaignId);
      if ("error" in created) return NextResponse.json({ error: created.error }, { status: created.status });
      return NextResponse.json({ ok: true, ...created });
    }
    return NextResponse.json({ error: "Choose a campaign action." }, { status: 400 });
  } catch (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json({ error: "Apply the marketing publishing migration before saving campaign drafts." }, { status: 409 });
    }
    return NextResponse.json({ error: "The campaign draft could not be saved." }, { status: 400 });
  }
}
