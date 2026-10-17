import { readMembershipPack } from "@/lib/intake-delivery";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientPortalUser, readClientMembership } from "@/lib/client-portal";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ packId: string; photoId: string }> }) {
  const { packId, photoId } = await params;
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" };
  const user = await clientPortalUser();
  const membership = user ? await readClientMembership(user.email) : null;
  const pack = membership ? await readMembershipPack(membership, packId) : null;
  const photo = pack?.photos.find((asset) => asset.id === photoId);
  if (!photo || !membership || !photo.storageKey.startsWith(`${membership.orgId}/${membership.jobId}/`)) return new Response("Photo unavailable", { status: 404, headers });
  const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").download(photo.storageKey);
  if (error || !data) return new Response("Photo unavailable", { status: 503, headers });
  return new Response(data, { headers: { ...headers, "Content-Type": photo.mimeType ?? "image/jpeg" } });
}
