import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientPortalUser, readClientMembership } from "@/lib/client-portal";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ submissionId: string; mediaId: string }> }) {
  const { submissionId, mediaId } = await params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };
  const user = await clientPortalUser();
  const membership = user ? await readClientMembership(user.email) : null;
  if (!membership || !z.string().uuid().safeParse(submissionId).success || !z.string().uuid().safeParse(mediaId).success) return new Response("Unavailable", { status: 404, headers });
  const photo = await prisma.fileAsset.findFirst({
    where: { id: mediaId, type: "PHOTO", jobId: membership.jobId, job: { orgId: membership.orgId }, tags: { has: `submission:${submissionId}` }, OR: membership.historyInviteIds.map((id) => ({ tags: { has: `intake:${id}` } })) },
    select: { storageKey: true, mimeType: true },
  });
  let media = photo;
  if (!media) {
    const row = await prisma.activityLog.findFirst({ where: { id: mediaId, orgId: membership.orgId, jobId: membership.jobId, action: AUDIO_RECEIVED } });
    const audio = row?.metadata as { inviteId?: string; submissionId?: string; storageKey?: string; mimeType?: string } | null;
    const prefix = `${membership.orgId}/${membership.jobId}/intake/`;
    if (audio?.submissionId === submissionId && audio.inviteId && membership.historyInviteIds.includes(audio.inviteId) && audio.storageKey?.startsWith(`${prefix}${audio.inviteId}/voice-`)) {
      media = { storageKey: audio.storageKey, mimeType: audio.mimeType || "audio/mp4" };
    }
  }
  if (!media?.storageKey.startsWith(`${membership.orgId}/${membership.jobId}/`)) return new Response("Unavailable", { status: 404, headers });
  const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").download(media.storageKey);
  if (error || !data) return new Response("Unavailable", { status: 503, headers });
  return new Response(data, { headers: { ...headers, "Content-Type": media.mimeType || "application/octet-stream" } });
}
