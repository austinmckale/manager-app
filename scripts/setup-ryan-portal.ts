import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CLIENT_PORTAL_ACCESS, RYAN_PORTAL_EMAILS } from "../src/lib/client-portal-policy";

async function main() {
  loadEnvFile(process.env.INTAKE_WORKER_ENV_FILE || ".env.intake-production-verified");
  const inviteId = z.string().uuid().parse(process.argv[2]);
  const { prisma } = await import("../src/lib/prisma");
  try {
    const invite = await prisma.activityLog.findUnique({ where: { id: inviteId }, include: { job: { select: { orgId: true } } } });
    if (!invite || invite.action !== "field.invite.created" || !invite.jobId || invite.job?.orgId !== invite.orgId || invite.orgId !== process.env.DEFAULT_ORG_ID) throw new Error("Invite organization does not match.");
    const revoked = await prisma.activityLog.findFirst({ where: { orgId: invite.orgId, action: "field.invite.revoked", metadata: { path: ["inviteId"], equals: inviteId } } });
    if (revoked) throw new Error("Invite has been revoked.");
    const existing = await prisma.activityLog.findFirst({ where: { orgId: invite.orgId, action: CLIENT_PORTAL_ACCESS, metadata: { path: ["inviteId"], equals: inviteId } } });
    const metadata = { emails: [...RYAN_PORTAL_EMAILS], inviteId };
    if (existing) await prisma.activityLog.update({ where: { id: existing.id }, data: { metadata } });
    else await prisma.activityLog.create({ data: { id: randomUUID(), orgId: invite.orgId, actorId: invite.actorId, jobId: invite.jobId, action: CLIENT_PORTAL_ACCESS, metadata } });
    const response = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } });
    const settings = response.ok ? await response.json() : null;
    console.log(JSON.stringify({ mappedAccounts: RYAN_PORTAL_EMAILS.length, googleEnabled: settings?.external?.google === true }));
  } finally { await prisma.$disconnect(); }
}
main().catch(() => { console.error("Portal setup failed. Verify the existing invite and production configuration."); process.exitCode = 1; });
