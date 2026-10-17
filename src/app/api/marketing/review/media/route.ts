import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { loadContentReview } from "@/lib/content-review-store";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { z } from "zod";

export async function GET(request: Request) {
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return new Response("Unauthorized", { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return new Response("Forbidden", { status: 403 });
  const params = new URL(request.url).searchParams;
  const draftId = z.string().uuid().safeParse(params.get("draftId"));
  const audioId = z.string().uuid().safeParse(params.get("audioId"));
  if (!draftId.success || !audioId.success) return new Response("Not found", { status: 404 });
  const context = await loadContentReview(auth.orgId, draftId.data);
  const audio = context?.audio.find((item) => item.id === audioId.data);
  if (!audio) return new Response("Not found", { status: 404 });
  const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets").download(audio.storageKey);
  if (error || !data) return new Response("Recording unavailable", { status: 404 });
  return new Response(await data.arrayBuffer(), { headers: { "Content-Type": audio.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
