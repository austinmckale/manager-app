import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { loadContentReview } from "@/lib/content-review-store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return new Response("Unauthorized", { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return new Response("Forbidden", { status: 403 });
  const params = new URL(request.url).searchParams;
  const draftId = z.string().uuid().safeParse(params.get("draftId"));
  if (!draftId.success) return new Response("Not found", { status: 404 });
  const photoRaw = params.get("photoId");
  const photoId = photoRaw === null ? null : z.string().uuid().safeParse(photoRaw);
  const audioId = z.string().uuid().safeParse(params.get("audioId"));
  if (photoId && !photoId.success) return new Response("Not found", { status: 404 });
  if (!photoId && !audioId.success) return new Response("Not found", { status: 404 });
  const context = await loadContentReview(auth.orgId, draftId.data);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "job-assets";
  if (photoId?.success) {
    const photo = context?.assets.find((asset) => asset.id === photoId.data);
    if (!photo) return new Response("Not found", { status: 404 });
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(photo.storageKey);
    if (error || !data) return new Response("Not found", { status: 404 });
    return new Response(await data.arrayBuffer(), { headers: { "Content-Type": photo.mimeType || "image/jpeg", ...privateHeaders } });
  }
  if (!audioId.success) return new Response("Not found", { status: 404 });
  const audio = context?.audio.find((item) => item.id === audioId.data);
  if (!audio) return new Response("Not found", { status: 404 });
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(audio.storageKey);
  if (error || !data) return new Response("Recording unavailable", { status: 404 });
  return new Response(await data.arrayBuffer(), { headers: { "Content-Type": audio.mimeType, ...privateHeaders } });
}
