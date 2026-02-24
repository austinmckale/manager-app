import { subHours } from "date-fns";
import { LeadSource, LeadStage } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const inputSchema = z.object({
  orgId: z.string().uuid().optional(),
  externalRef: z.string().max(191).optional(),
  contactName: z.string().optional(),
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  address: z.string().optional(),
  serviceType: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  message: z.string().optional(),
});

function resolveSource(source?: string): LeadSource {
  const value = (source ?? "").trim().toLowerCase();
  if (["website", "web", "web_form", "website_form", "form"].includes(value)) return LeadSource.WEBSITE_FORM;
  if (["phone", "call", "phone_call"].includes(value)) return LeadSource.PHONE_CALL;
  if (["text", "sms"].includes(value)) return LeadSource.TEXT;
  if (["referral", "refer"].includes(value)) return LeadSource.REFERRAL;
  return LeadSource.OTHER;
}

function getIntakeKey(request: Request) {
  const fromHeader = request.headers.get("x-lead-intake-key");
  if (fromHeader) return fromHeader;
  const auth = request.headers.get("authorization");
  if (!auth) return "";
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "/api/leads/intake" });
}

export async function POST(request: Request) {
  const secret = process.env.LEAD_INGEST_API_KEY;
  if (!secret) {
    return NextResponse.json({ error: "LEAD_INGEST_API_KEY is not configured." }, { status: 500 });
  }

  const intakeKey = getIntakeKey(request);
  if (intakeKey !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = inputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const orgId = data.orgId ?? process.env.DEFAULT_ORG_ID ?? "";
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required (payload.orgId or DEFAULT_ORG_ID env)." }, { status: 400 });
  }

  const contactName = (data.contactName || data.name || data.phone || data.email || "Unknown Lead").trim();
  const source = resolveSource(data.source);
  const notes = data.notes || data.message || null;

  if (data.externalRef) {
    const existingByRef = await prisma.lead.findFirst({
      where: { orgId, externalRef: data.externalRef },
      select: { id: true },
    });

    if (existingByRef) {
      return NextResponse.json({ ok: true, deduped: true, leadId: existingByRef.id, by: "externalRef" });
    }
  }

  const dedupeWhere = {
    orgId,
    createdAt: { gte: subHours(new Date(), 12) },
    stage: { in: [LeadStage.NEW, LeadStage.CONTACTED, LeadStage.SITE_VISIT_SET, LeadStage.ESTIMATE_SENT] },
    OR: [
      ...(data.phone ? [{ phone: data.phone }] : []),
      ...(data.email ? [{ email: data.email }] : []),
    ],
  };

  if (dedupeWhere.OR.length > 0) {
    const existingRecent = await prisma.lead.findFirst({
      where: dedupeWhere,
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });

    if (existingRecent) {
      return NextResponse.json({ ok: true, deduped: true, leadId: existingRecent.id, by: "recent_contact" });
    }
  }

  const lead = await prisma.lead.create({
    data: {
      orgId,
      externalRef: data.externalRef || null,
      contactName,
      phone: data.phone || null,
      email: data.email || null,
      address: data.address || null,
      serviceType: data.serviceType || null,
      source,
      stage: LeadStage.NEW,
      notes,
      rawPayload: body,
    },
  });

  await prisma.activityLog.create({
    data: {
      orgId,
      action: "lead.intake.webhook",
      metadata: {
        leadId: lead.id,
        source,
      },
    },
  });

  return NextResponse.json({ ok: true, deduped: false, leadId: lead.id });
}
