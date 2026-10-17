import Link from "next/link";
import { requireAuth } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/lib/demo";
import { INTAKE_PACK, INTAKE_EMAIL, packSchema } from "@/lib/intake-delivery";
import { IntakeTranscriptionQueue } from "@/components/intake-transcription-queue";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { uploadInviteToken, resolveUploadInvite } from "@/lib/field-intake";
import { loadHeldSubmissions } from "@/lib/marketing-evidence-store";
import { MarketingEvidenceQueue } from "@/components/marketing-evidence-queue";

import { processingSettings, processingId } from "@/lib/marketing-processing";
import { MarketingProcessingControls } from "@/components/marketing-processing-controls";

export const dynamic = "force-dynamic";
export default async function DeliveryQueuePage() {
  const auth = await requireAuth();
  if (!canManageOrg(auth.role)) return <p>Only the owner and admins can view deliveries.</p>;
  const demo = isDemoMode();
  const held = demo ? [] : await loadHeldSubmissions(auth.orgId);
  const settings = demo ? { enabled: false, mode: "manual" as const, dailyCallLimit: 60, testRequestedAt: null, testDraftId: null, testSubmissionId: null } : await processingSettings(prisma, auth.orgId);
  const heartbeatRow = demo ? null : await prisma.activityLog.findFirst({ where: { id: processingId(auth.orgId, "heartbeat"), orgId: auth.orgId } });
  const heartbeat = heartbeatRow?.metadata as { checkedAt: string; state: string; mode: string; apiKeyReady: boolean; model: string } | null;
  const usage = demo ? null : await prisma.activityLog.findFirst({ where: { id: processingId(auth.orgId, "usage:" + new Date().toISOString().slice(0, 10)), orgId: auth.orgId } });
  const callsToday = Number((usage?.metadata as { calls?: number } | null)?.calls || 0);
  const records = demo ? [] : await prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: { in: [INTAKE_PACK, INTAKE_EMAIL] } }, orderBy: { createdAt: "desc" }, take: 200 });
  const packs = records.filter((record) => record.action === INTAKE_PACK).flatMap((record) => { const parsed = packSchema.safeParse(record.metadata); return parsed.success ? [{ id: record.id, pack: parsed.data }] : []; });
  const voice = demo ? [] : await prisma.activityLog.findMany({ where: { orgId: auth.orgId, action: AUDIO_RECEIVED, OR: [{ metadata: { path: ["status"], equals: "queued" } }, { metadata: { path: ["status"], equals: "failed" } }] }, orderBy: { createdAt: "desc" }, take: 50 });
  const voiceItems = voice.map((row) => { const meta = row.metadata as { status?: string; transcriptionAttempts?: number }; return { id: row.id, receivedAt: row.createdAt.toISOString(), failed: meta.status === "failed", attempts: typeof meta.transcriptionAttempts === "number" ? meta.transcriptionAttempts : 0 }; });
  const activeInvites = new Map(await Promise.all([...new Set(packs.map(({ pack }) => pack.inviteId))].map(async (id) => [id, !!await resolveUploadInvite(uploadInviteToken(id))] as const)));
  return <div className="space-y-5"><div><p className="text-xs uppercase tracking-widest text-[#b4411b]">Photo delivery</p><h1 className="mt-2 text-2xl font-semibold">Processing and review</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Uploads are saved online. Your local worker transcribes recordings and prepares drafts while this PC is awake. Review drafts before any client release. A saved delivery time does not release a pack; the client-choice and automatic delivery flow is not connected yet.</p></div><div className="rounded-2xl border bg-white p-4 text-sm"><p><strong>Email:</strong> automatic sending is disabled. Intended recipients are rhisolutions316@gmail.com and austinmck17@gmail.com.</p><p className="mt-2"><strong>SMS:</strong> not connected. No mobile recipient or messaging credentials are configured.</p><p className="mt-2"><strong>AI:</strong> Choose Hybrid, Ollama or manual processing below. Voice transcription runs locally. Hybrid requires a configured OpenAI API key.</p></div><p className="text-sm"><strong>Discord owner alerts:</strong> {process.env.MARKETING_ALERTS_DISCORD_WEBHOOK_URL ? "configured for uploads, saved drafts and processing issues" : "not configured"}. Phone notifications depend on your Discord notification settings.</p><MarketingProcessingControls settings={settings} heartbeat={heartbeat} callsToday={callsToday} /><MarketingEvidenceQueue items={held} /><IntakeTranscriptionQueue items={voiceItems} /><Link href="/marketing/saved" className="inline-block text-sm text-[#b4411b] underline">Open saved copies for editing</Link>{!packs.length ? <p className="rounded-2xl border p-5 text-sm text-slate-600">No finished packs queued yet. New submissions are picked up after 15 minutes without another photo. Test submissions are skipped.</p> : packs.map(({ id, pack }) => { const notification = records.find((record) => record.action === INTAKE_EMAIL && (record.metadata as { packId?: string } | null)?.packId === id); const status = (notification?.metadata as { status?: string } | null)?.status; const available = pack.ownerApproved && !pack.isTest && activeInvites.get(pack.inviteId) && new Date(pack.deliverAt).getTime() <= new Date().getTime(); return <section key={id} className="rounded-2xl border bg-white p-4"><h2 className="font-semibold">{pack.draft.packName || "Job photo pack"}</h2><p className="mt-2 text-sm">{pack.isTest ? "Test pack — held" : !pack.ownerApproved ? "Held for review and explicit client release" : !activeInvites.get(pack.inviteId) ? "Client link unavailable" : available ? "Released to Ryan’s app" : "Release time not reached"} · {new Date(pack.deliverAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} Eastern</p><p className="mt-1 text-sm text-slate-500">Email: {status === "accepted" ? "sent through Gmail" : status === "claimed" ? "sending or needs checking — do not resend blindly" : "not sent — automatic email delivery is disabled"}</p>{available ? <Link href={`/send-photos/${uploadInviteToken(pack.inviteId)}/packs/${id}`} className="mt-3 inline-block text-sm text-[#b4411b] underline">Open finished pack</Link> : null}</section>; })}<p className="text-xs text-slate-500">Delivery times describe turnaround, not manual hours worked. This does not post to social accounts or start ad spending. Client links follow the upload link’s expiry and revocation.</p></div>;
}
