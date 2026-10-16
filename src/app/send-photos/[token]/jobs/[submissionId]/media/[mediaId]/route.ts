import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { resolveUploadInvite } from "@/lib/field-intake";
import { AUDIO_RECEIVED } from "@/lib/intake-audio";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; submissionId: string; mediaId: string }> }) {
  const { token, submissionId, mediaId } = await params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };
  if (!z.string().uuid().safeParse(submissionId).success || !z.string().uuid().safeParse(mediaId).success) return new Response("Unavailable", { status: 404, headers });
  const invite = await resolveUploadInvite(token);
  if (!invite) return new Response("Unavailable", { status: 404, headers });
  const photo = await prisma.fileAsset.findFirst({ where: { id: mediaId, type: "PHOTO", tags: { hasEvery: [`intake:${invite.id}`, `submission:${submissionId}`] }, job: { orgId: invite.orgId } }, select: { storageKey: true, mimeType: true } });
  let media = photo;
  if (!media) {
    const row = await prisma.activityLog.findFirst({ where: { id: mediaId, orgId: invite.orgId, action: AUDIO_RECEIVED } });
    const audio = row?.metadata as { inviteId?: string; submissionId?: string; storageKey?: string; mimeType?: string } | null;
    if (audio?.inviteId === invite.id && audio.submissionId === submissionId && audio.storageKey?.startsWith(`${invite.orgId}/${invite.jobId}/intake/${invite.id}/voice-`)) media = { storageKey: audio.storageKey, mimeType: audio.mimeType || "audio/mp4" };
  }
  if (!media) return new Response("Unavailable", { status: 404, headers });
  const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").download(media.storageKey);
  if (error || !data) return new Response("Unavailable", { status: 503, headers });
  return new Response(data, { headers: { ...headers, "Content-Type": media.mimeType || "application/octet-stream" } });
}
