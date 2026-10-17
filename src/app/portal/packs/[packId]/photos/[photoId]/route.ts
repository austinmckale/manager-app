export const dynamic = "force-dynamic";

export function GET() {
  return new Response("Photo unavailable", { status: 404, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" } });
}
