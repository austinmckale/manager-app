import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";
import { isDemoMode } from "@/lib/demo";
import { executeBufferSend, refreshBufferDelivery, testBufferDraft } from "@/lib/publishing/buffer-store";
import { PublishRejection } from "@/lib/publishing/types";

export const maxDuration = 120;
const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("refresh"), id: z.string().uuid() }),
  z.object({ action: z.literal("send"), draftId: z.string().uuid(), inputHash: z.string().regex(/^[a-f0-9]{64}$/), mode: z.enum(["draft", "queue"]), queueConfirmed: z.boolean(), selections: z.array(z.object({ channelId: z.string().min(1).max(200), assetIds: z.array(z.string().uuid()).min(1).max(10) })).min(1).max(3) }),
]);
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let auth;
  try { auth = await requireAuth({ allowFallback: false }); } catch { return NextResponse.json({ error: "Sign in again." }, { status: 401 }); }
  if (!isDashboardOwnerEmail(auth.email)) return NextResponse.json({ error: "Owner access required." }, { status: 403 });
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Nothing was sent." }, { status: 409 });
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Check the selected channels, photos and delivery option." }, { status: 400 });
  try {
    const input = body.data;
    if (input.action === "test") return NextResponse.json({ records: await testBufferDraft(auth.orgId, auth.userId) });
    if (input.action === "refresh") return NextResponse.json({ records: [await refreshBufferDelivery(auth.orgId, auth.userId, input.id)] });
    if (input.mode === "queue" && !input.queueConfirmed) return NextResponse.json({ error: "Confirm that Buffer may publish these posts using your queue schedule." }, { status: 400 });
    return NextResponse.json({ records: await executeBufferSend({ ...input, orgId: auth.orgId }, auth.userId) });
  } catch (error) {
    if (error instanceof PublishRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Buffer could not complete this request. Check the delivery history and Buffer before sending again." }, { status: 503 });
  }
}
