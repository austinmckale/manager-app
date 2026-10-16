import { prisma } from "@/lib/prisma";
import { resolveUploadInvite, PHOTO_RECEIVED } from "@/lib/field-intake";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { INTAKE_PACK, packSchema } from "@/lib/intake-delivery";
import { z } from "zod";

export async function intakeHistory(token: string) {
  const invite = await resolveUploadInvite(token);
  if (!invite) return null;
  const [records, photos] = await Promise.all([
    prisma.activityLog.findMany({ where: { orgId: invite.orgId, action: { in: [PHOTO_RECEIVED, AUDIO_RECEIVED, INTAKE_PACK] }, metadata: { path: ["inviteId"], equals: invite.id } }, orderBy: { createdAt: "asc" }, take: 1000 }),
    prisma.fileAsset.findMany({ where: { job: { orgId: invite.orgId }, type: "PHOTO", tags: { has: `intake:${invite.id}` } }, select: { id: true, fileName: true, storageKey: true, mimeType: true, tags: true }, take: 300 }),
  ]);
  const batches = new Map<string, { id: string; createdAt: string; location: string; note: string; transcript: string; voiceId: string | null; voicePending: boolean; packId: string | null; ready: boolean; photos: typeof photos }>();
  for (const record of records) {
    const meta = record.metadata as { submissionId?: string; location?: string; description?: string; transcript?: string; status?: string } | null;
    if (!meta?.submissionId || !z.string().uuid().safeParse(meta.submissionId).success) continue;
    let batch = batches.get(meta.submissionId);
    if (!batch) { batch = { id: meta.submissionId, createdAt: record.createdAt.toISOString(), location: "", note: "", transcript: "", voiceId: null, voicePending: false, packId: null, ready: false, photos: [] }; batches.set(batch.id, batch); }
    if (record.action === PHOTO_RECEIVED) { batch.location = meta.location || batch.location; batch.note = meta.description || batch.note; }
    if (record.action === AUDIO_RECEIVED) { batch.voiceId = record.id; batch.voicePending = meta.status !== "transcribed"; batch.transcript = meta.transcript || ""; }
    if (record.action === INTAKE_PACK) { const pack = packSchema.safeParse(record.metadata); if (pack.success) { batch.packId = record.id; batch.ready = !pack.data.isTest && new Date(pack.data.deliverAt) <= new Date(); } }
  }
  for (const batch of batches.values()) batch.photos = photos.filter((photo) => photo.tags.includes(`submission:${batch.id}`));
  return [...batches.values()].reverse();
}
