import { readIntakePack } from "@/lib/intake-delivery";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string; packId: string; photoId: string }> }) {
  const { token, packId, photoId } = await params;
  const pack = await readIntakePack(token, packId);
  const photo = pack?.photos.find((asset) => asset.id === photoId);
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
  if (!photo) return new Response("Photo unavailable", { status: 404, headers });
  const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").download(photo.storageKey);
  if (error || !data) return new Response("Photo unavailable", { status: 503, headers });
  return new Response(data, { headers: { ...headers, "Content-Type": photo.mimeType ?? "image/jpeg", "X-Content-Type-Options": "nosniff" } });
}
