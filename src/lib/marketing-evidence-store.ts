import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { GENERATION_ACTION, generationRecordSchema } from "@/lib/marketing-evidence";

export async function loadHeldSubmissions(orgId: string) {
  const rows = await prisma.activityLog.findMany({ where: { orgId, action: GENERATION_ACTION, metadata: { path: ["status"], equals: "held" } }, orderBy: { createdAt: "desc" }, take: 50 });
  const bucket = supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets");
  return Promise.all(rows.flatMap((row) => {
    const parsed = generationRecordSchema.safeParse(row.metadata);
    if (!parsed.success) return [];
    const state = parsed.data;
    return [(async () => {
      const photos = await prisma.fileAsset.findMany({ where: { type: "PHOTO", job: { orgId }, tags: { hasEvery: [`intake:${state.inviteId}`, `submission:${state.submissionId}`] } }, select: { id: true, storageKey: true, fileName: true, description: true }, orderBy: { createdAt: "asc" }, take: 24 });
      const recordings = await prisma.activityLog.findMany({ where: { orgId, action: AUDIO_RECEIVED, AND: [{ metadata: { path: ["inviteId"], equals: state.inviteId } }, { metadata: { path: ["submissionId"], equals: state.submissionId } }] }, orderBy: { createdAt: "asc" }, take: 30 });
      const audio = recordings.flatMap((record) => {
        const meta = record.metadata as Record<string, unknown>;
        if (typeof meta.storageKey !== "string" || !meta.storageKey.startsWith(`${orgId}/`)) return [];
        return [{ id: record.id, storageKey: meta.storageKey, transcript: typeof meta.transcript === "string" ? meta.transcript : "", status: String(meta.status) }];
      });
      const signed = await bucket.createSignedUrls([...photos.map((photo) => photo.storageKey), ...audio.map((record) => record.storageKey)], 900);
      const urls = new Map(signed.data?.map((item) => [item.path, item.signedUrl]) || []);
      return { id: row.id, ownerNotes: state.ownerNotes, postType: state.postType, issues: state.issues || state.evidence?.reasons || [], evidence: state.evidence || null, photos: photos.map((photo) => ({ id: photo.id, name: photo.fileName, notes: photo.description || "", url: urls.get(photo.storageKey) || "" })), audio: audio.map((record) => ({ id: record.id, transcript: record.transcript, status: record.status, url: urls.get(record.storageKey) || "" })) };
    })()];
  }));
}
