import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo";
import { resolveUploadInvite } from "@/lib/field-intake";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = (isDemoMode() && token === "preview") || await resolveUploadInvite(token).catch(() => null);
  const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" };
  if (!valid) return NextResponse.json({ error: "Upload link unavailable" }, { status: 404, headers });
  const start = `/send-photos/${encodeURIComponent(token)}`;
  return NextResponse.json({
    id: start, name: "RHI Photos", short_name: "RHI Photos",
    description: "Send job photos and a quick note to RHI Pros.",
    start_url: start, scope: "/send-photos/", display: "standalone",
    background_color: "#faf8f4", theme_color: "#b4411b",
    icons: [{ src: "/send-photos/app-icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }],
  }, { headers: { ...headers, "Content-Type": "application/manifest+json" } });
}
