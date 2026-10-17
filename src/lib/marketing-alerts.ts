import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

export const OWNER_ALERT = "marketing.owner.alert";
const HEALTH = "marketing.worker.health";
const kinds = z.enum(["received", "ready", "worker_failed", "worker_recovered", "test"]);
const alertSchema = z.object({ kind: kinds, status: z.enum(["pending", "sending", "sent", "failed"]), attempts: z.number().int().nonnegative(), nextAttemptAt: z.string().nullable().optional(), claimedAt: z.string().optional(), providerMessageId: z.string().optional() });
type Kind = z.infer<typeof kinds>;
function idFor(orgId: string, key: string) {
  const hex = createHash("sha256").update(`rhi-owner-alert:${orgId}:${key}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function discordAlertUrl(value = process.env.MARKETING_ALERTS_DISCORD_WEBHOOK_URL): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || !["discord.com", "discordapp.com"].includes(url.hostname) || url.port || url.username || url.password || !/^\/api\/webhooks\/\d{16,22}\/[A-Za-z0-9_-]{20,200}$/.test(url.pathname)) return null;
    url.search = "?wait=true"; url.hash = "";
    return url.toString();
  } catch { return null; }
}
export function alertMessage(kind: Kind) {
  const lines: Record<Kind, string> = {
    received: "New job submission received. Photos are saved online; local AI processing will follow.",
    ready: "A marketing draft has been saved. It needs your review before client release or publishing.",
    worker_failed: "Local marketing processing needs attention. Uploaded material remains saved; check the processing page and worker status.",
    worker_recovered: "The local marketing worker completed a check again after a processing problem.",
    test: "Discord marketing alerts are connected. This channel will receive upload, draft-ready and worker-problem alerts.",
  };
  return `RHI Pros — ${lines[kind]}\nhttps://app.rhipros.com/${kind === "ready" ? "marketing/saved" : kind === "received" ? "marketing" : "marketing/delivery"}`;
}
async function enqueue(orgId: string, jobId: string | null, key: string, kind: Kind) {
  const id = idFor(orgId, key);
  await prisma.activityLog.upsert({ where: { id }, create: { id, orgId, jobId, action: OWNER_ALERT, metadata: { kind, status: "pending", attempts: 0 } }, update: {} });
  return id;
}
async function dispatch(orgId: string, id: string) {
  const url = discordAlertUrl();
  if (!url) return false;
  const row = await prisma.activityLog.findFirst({ where: { id, orgId, action: OWNER_ALERT } });
  const parsed = alertSchema.safeParse(row?.metadata);
  if (!parsed.success) return false;
  const meta = parsed.data;
  if (meta.status === "sent" || meta.status === "failed" || (meta.nextAttemptAt && new Date(meta.nextAttemptAt).getTime() > Date.now())) return false;
  if (meta.status === "sending" && Date.now() - new Date(meta.claimedAt || "").getTime() < 120000) return false;
  const claimed = { ...meta, status: "sending", attempts: meta.attempts + 1, claimedAt: new Date().toISOString() };
  const claim = await prisma.activityLog.updateMany({ where: { id, orgId, action: OWNER_ALERT, metadata: { equals: row!.metadata! } }, data: { metadata: claimed } });
  if (claim.count !== 1) return false;
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: alertMessage(meta.kind), allowed_mentions: { parse: [] } }), signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw new Error("discord-unavailable");
    const message = await response.json() as { id?: string };
    if (!message.id) throw new Error("discord-unconfirmed");
    await prisma.activityLog.update({ where: { id }, data: { metadata: { ...claimed, status: "sent", providerMessageId: message.id, nextAttemptAt: null } } });
    return true;
  } catch {
    // A timeout can have reached Discord. Retrying favors delivery and may duplicate
    // that notification; stable event IDs prevent ordinary upload retries duplicating it.
    await prisma.activityLog.update({ where: { id }, data: { metadata: { ...claimed, status: claimed.attempts >= 5 ? "failed" : "pending", nextAttemptAt: new Date(Date.now() + 60000 * claimed.attempts).toISOString() } } });
    return false;
  }
}
export async function notifyIntakeReceived(orgId: string, jobId: string, inviteId: string, submissionId: string) {
  const id = await enqueue(orgId, jobId, `received:${inviteId}:${submissionId}`, "received");
  return dispatch(orgId, id);
}
export async function runMarketingAlerts(orgId: string, health?: "failed" | "healthy", test = false) {
  if (!discordAlertUrl()) return { alertsConfigured: false, alertsSent: 0 };
  if (test) {
    const id = await enqueue(orgId, null, `test:${randomUUID()}`, "test");
    return { alertsConfigured: true, alertsSent: await dispatch(orgId, id) ? 1 : 0 };
  }
  // Recover alerts for recent receipts if the cloud request couldn't notify.
  const rows = await prisma.activityLog.findMany({ where: { orgId, action: { in: ["field.photo.received", "marketing.intake.pack.ready"] }, createdAt: { gte: new Date(Date.now() - 2 * 86400000) } }, orderBy: { createdAt: "asc" }, take: 1000 });
  for (const row of rows) {
    const meta = row.metadata as { inviteId?: string; submissionId?: string; description?: string; isTest?: boolean } | null;
    if (!meta?.inviteId || !meta.submissionId || meta.isTest || /^TEST\b/i.test(meta.description || "")) continue;
    const kind = row.action === "field.photo.received" ? "received" : "ready";
    await enqueue(orgId, row.jobId, `${kind}:${meta.inviteId}:${meta.submissionId}`, kind);
  }
  if (health) {
    const id = idFor(orgId, "health");
    const previous = await prisma.activityLog.findUnique({ where: { id } });
    const old = previous?.metadata as { failing?: boolean; incidentId?: string } | null;
    if (health === "failed" && !old?.failing) {
      const incidentId = randomUUID();
      await enqueue(orgId, null, `failure:${incidentId}`, "worker_failed");
      await prisma.activityLog.upsert({ where: { id }, create: { id, orgId, action: HEALTH, metadata: { failing: true, incidentId } }, update: { metadata: { failing: true, incidentId } } });
    } else if (health === "healthy" && old?.failing) {
      await enqueue(orgId, null, `recovered:${old.incidentId}`, "worker_recovered");
      await prisma.activityLog.update({ where: { id }, data: { metadata: { failing: false, incidentId: old.incidentId } } });
    }
  }
  const pending = await prisma.activityLog.findMany({ where: { orgId, action: OWNER_ALERT, OR: [{ metadata: { path: ["status"], equals: "pending" } }, { metadata: { path: ["status"], equals: "sending" } }] }, orderBy: { createdAt: "asc" }, take: 10 });
  let alertsSent = 0;
  for (const row of pending) if (await dispatch(orgId, row.id)) alertsSent++;
  return { alertsConfigured: true, alertsSent };
}
