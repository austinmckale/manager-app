import { NextResponse } from "next/server";
import { pollDelivery } from "@/lib/publishing/execute";
import { authorizePublishing } from "@/lib/publishing/http";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizePublishing();
  if ("response" in authorized) return authorized.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "That delivery is not available." }, { status: 404 });
  const delivery = await pollDelivery(authorized.auth.orgId, id);
  if (!delivery) return NextResponse.json({ error: "That delivery is not available." }, { status: 404 });
  return NextResponse.json({
    id: delivery.id,
    destination: delivery.destination,
    status: delivery.status,
    providerPostId: delivery.providerPostId,
    error: delivery.lastError,
    attemptCount: delivery.attemptCount,
    mock: delivery.providerPostId?.startsWith("mock:") ?? false,
    publishedAt: delivery.publishedAt,
  });
}
