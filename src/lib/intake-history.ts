import { prisma } from "@/lib/prisma";
import { resolveUploadInvite, PHOTO_RECEIVED } from "@/lib/field-intake";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { INTAKE_PACK, packSchema } from "@/lib/intake-delivery";
import { z } from "zod";

type HistoryPhoto = { id: string; fileName: string; storageKey: string; mimeType: string | null; tags: string[] };
type HistoryRecord = { id: string; action: string; createdAt: Date; metadata: unknown };

function buildBatches(records: HistoryRecord[], photos: HistoryPhoto[]) {
  const batches = new Map<string, { id: string; createdAt: string; location: string; note: string; transcript: string; voiceId: string | null; voicePending: boolean; packId: string | null; ready: boolean; photos: HistoryPhoto[] }>();
  for (const record of records) {
    const meta = record.metadata as { submissionId?: string; location?: string; description?: string; transcript?: string; status?: string } | null;
    if (!meta?.submissionId || !z.string().uuid().safeParse(meta.submissionId).success) continue;
    let batch = batches.get(meta.submissionId);
    if (!batch) { batch = { id: meta.submissionId, createdAt: record.createdAt.toISOString(), location: "", note: "", transcript: "", voiceId: null, voicePending: false, packId: null, ready: false, photos: [] }; batches.set(batch.id, batch); }
    if (record.action === PHOTO_RECEIVED) { batch.location = meta.location || batch.location; batch.note = meta.description || batch.note; }
    if (record.action === AUDIO_RECEIVED) { batch.voiceId = record.id; batch.voicePending = meta.status !== "transcribed"; batch.transcript = meta.transcript || ""; }
    if (record.action === INTAKE_PACK) { const pack = packSchema.safeParse(record.metadata); if (pack.success) { batch.packId = record.id; batch.ready = pack.data.ownerApproved && !pack.data.isTest && new Date(pack.data.deliverAt) <= new Date(); } }
  }
  for (const batch of batches.values()) batch.photos = photos.filter((photo) => photo.tags.includes(`submission:${batch.id}`));
  return [...batches.values()].reverse();
}

export async function intakeHistory(token: string) {
  const invite = await resolveUploadInvite(token);
  if (!invite) return null;
  const [records, photos] = await Promise.all([
    prisma.activityLog.findMany({ where: { orgId: invite.orgId, action: { in: [PHOTO_RECEIVED, AUDIO_RECEIVED, INTAKE_PACK] }, metadata: { path: ["inviteId"], equals: invite.id } }, orderBy: { createdAt: "asc" }, take: 1000 }),
    prisma.fileAsset.findMany({ where: { job: { orgId: invite.orgId }, type: "PHOTO", tags: { has: `intake:${invite.id}` } }, select: { id: true, fileName: true, storageKey: true, mimeType: true, tags: true }, take: 300 }),
  ]);
  return buildBatches(records, photos);
}

export async function intakeHistoryForInvites(scope: { orgId: string; jobId: string; historyInviteIds: string[] }) {
  const inviteIds = [...new Set(scope.historyInviteIds.filter((id) => z.string().uuid().safeParse(id).success))];
  if (!inviteIds.length) return [];
  const allowed = new Set(inviteIds);
  const [records, photos] = await Promise.all([
    prisma.activityLog.findMany({ where: { orgId: scope.orgId, jobId: scope.jobId, action: { in: [PHOTO_RECEIVED, AUDIO_RECEIVED, INTAKE_PACK] } }, orderBy: { createdAt: "asc" }, take: 1000 }),
    prisma.fileAsset.findMany({ where: { jobId: scope.jobId, job: { orgId: scope.orgId }, type: "PHOTO", OR: inviteIds.map((id) => ({ tags: { has: `intake:${id}` } })) }, select: { id: true, fileName: true, storageKey: true, mimeType: true, tags: true }, take: 300 }),
  ]);
  const owned = records.filter((record) => {
    const inviteId = (record.metadata as { inviteId?: string } | null)?.inviteId;
    return Boolean(inviteId && allowed.has(inviteId));
  });
  return buildBatches(owned, photos.filter((photo) => inviteIds.some((id) => photo.tags.includes(`intake:${id}`))));
}
