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
  service: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  message: z.string().optional(),
  city: z.string().optional(),
  zip: z.string().optional(),
  timeline: z.string().optional(),
  details: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
  landing_path: z.string().optional(),
});

function resolveSource(source?: string): LeadSource {
  const value = (source ?? "").trim().toLowerCase();
  if (["website", "web", "web_form", "website_form", "form"].includes(value)) return LeadSource.WEBSITE_FORM;
  if (["phone", "call", "phone_call"].includes(value)) return LeadSource.PHONE_CALL;
  if (["text", "sms"].includes(value)) return LeadSource.TEXT;
  if (["referral", "refer"].includes(value)) return LeadSource.REFERRAL;
  return LeadSource.OTHER;
}

function normalizePhone(value?: string) {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits : value.trim();
}

function getIntakeKey(request: Request) {
  const fromHeader = request.headers.get("x-lead-intake-key");
  if (fromHeader) return fromHeader;
  const auth = request.headers.get("authorization");
  if (!auth) {
    const url = new URL(request.url);
    return url.searchParams.get("key") ?? "";
  }
  if (!auth.toLowerCase().startsWith("bearer ")) return "";
  return auth.slice(7).trim();
}

function getCorsOrigin(request: Request) {
  const configured = (process.env.LEAD_INGEST_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const requestOrigin = request.headers.get("origin") ?? "";
  if (!requestOrigin || configured.length === 0) return "*";
  return configured.includes(requestOrigin) ? requestOrigin : "null";
}

function corsHeaders(request: Request) {
  return {
    "Access-Control-Allow-Origin": getCorsOrigin(request),
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Lead-Intake-Key",
  };
}

async function parseBody(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    return Object.fromEntries(form.entries());
  }
  return request.json();
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "/api/leads/intake" });
}

export async function OPTIONS(request: Request) {
  return NextResponse.json({ ok: true }, { headers: corsHeaders(request) });
}

export async function POST(request: Request) {
  const secret = process.env.LEAD_INGEST_API_KEY;
  if (!secret) {
    return NextResponse.json({ error: "LEAD_INGEST_API_KEY is not configured." }, { status: 500, headers: corsHeaders(request) });
  }

  const intakeKey = getIntakeKey(request);
  if (intakeKey !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders(request) });
  }

  const body = await parseBody(request);
  const parsed = inputSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400, headers: corsHeaders(request) });
  }

  const data = parsed.data;
  const orgId = data.orgId ?? process.env.DEFAULT_ORG_ID ?? "";
  if (!orgId) {
    return NextResponse.json({ error: "orgId is required (payload.orgId or DEFAULT_ORG_ID env)." }, { status: 400, headers: corsHeaders(request) });
  }

  const contactName = (data.contactName || data.name || data.phone || data.email || "Unknown Lead").trim();
  const normalizedPhone = normalizePhone(data.phone);
  const normalizedEmail = (data.email ?? "").trim().toLowerCase();
  const source = resolveSource(data.source);
  const notesParts = [data.notes, data.message, data.details].filter(Boolean);
  if (data.timeline) notesParts.push(`Timeline: ${data.timeline}`);
  if (data.city) notesParts.push(`City: ${data.city}`);
  if (data.zip) notesParts.push(`ZIP: ${data.zip}`);
  const notes = notesParts.length > 0 ? notesParts.join("\n") : null;

  if (data.externalRef) {
    const existingByRef = await prisma.lead.findFirst({
      where: { orgId, externalRef: data.externalRef },
      select: { id: true },
    });

    if (existingByRef) {
      return NextResponse.json({ ok: true, deduped: true, leadId: existingByRef.id, by: "externalRef" }, { headers: corsHeaders(request) });
    }
  }

  const dedupeWhere = {
    orgId,
    createdAt: { gte: subHours(new Date(), 12) },
    stage: { in: [LeadStage.NEW, LeadStage.CONTACTED, LeadStage.SITE_VISIT_SET, LeadStage.ESTIMATE_SENT] },
    OR: [
      ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
      ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
    ],
  };

  if (dedupeWhere.OR.length > 0) {
    const existingRecent = await prisma.lead.findFirst({
      where: dedupeWhere,
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });

    if (existingRecent) {
      return NextResponse.json({ ok: true, deduped: true, leadId: existingRecent.id, by: "recent_contact" }, { headers: corsHeaders(request) });
    }
  }

  const lead = await prisma.lead.create({
    data: {
      orgId,
      externalRef: data.externalRef || null,
      contactName,
      phone: normalizedPhone || null,
      email: normalizedEmail || null,
      address: data.address || null,
      serviceType: data.serviceType || data.service || null,
      source,
      stage: LeadStage.NEW,
      notes,
      rawPayload: body,
      utmSource: data.utm_source || null,
      utmMedium: data.utm_medium || null,
      utmCampaign: data.utm_campaign || null,
      utmContent: data.utm_content || null,
      utmTerm: data.utm_term || null,
      landingPath: data.landing_path || null,
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

  return NextResponse.json({ ok: true, deduped: false, leadId: lead.id }, { headers: corsHeaders(request) });
}
