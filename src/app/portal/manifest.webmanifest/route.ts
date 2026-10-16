import { NextResponse } from "next/server";
export function GET() {
  return NextResponse.json({ id: "/portal", name: "RHI Photos", short_name: "RHI Photos", start_url: "/portal", scope: "/", display: "standalone", background_color: "#faf8f4", theme_color: "#b4411b", icons: [{ src: "/send-photos/app-icon.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }] }, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
