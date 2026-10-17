import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { BUFFER_CHANNEL_SELECTION, bufferSelectionId, discoverBufferChannels } from "@/lib/publishing/buffer";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only." }, { status: 409 });
  const body = z.object({ channelIds: z.array(z.string().min(1).max(200)).max(20) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Choose your Buffer channels." }, { status: 400 });
  try {
    const channels = await discoverBufferChannels(process.env.BUFFER_API_KEY || "");
    const selected = channels.filter((channel) => body.data.channelIds.includes(channel.id));
    if (selected.length !== new Set(body.data.channelIds).size) return NextResponse.json({ error: "A selected channel is no longer available in this Buffer account. Check the connection again." }, { status: 409 });
    const id = bufferSelectionId(auth.orgId);
    const metadata = { channels: selected, checkedAt: new Date().toISOString(), publishingEnabled: false };
    await prisma.activityLog.upsert({ where: { id }, create: { id, orgId: auth.orgId, actorId: auth.userId, action: BUFFER_CHANNEL_SELECTION, metadata }, update: { metadata, actorId: auth.userId } });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Buffer verification failed. Check the API key and its channel permissions." }, { status: 503 }); }
}
