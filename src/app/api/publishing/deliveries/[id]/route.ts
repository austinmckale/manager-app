import { NextResponse } from "next/server";
import { pollDelivery } from "@/lib/publishing/execute";
import { authorizePublishing } from "@/lib/publishing/http";
import { isMockPostId } from "@/lib/publishing/deliver";
import { PublishRejection } from "@/lib/publishing/types";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizePublishing();
  if ("response" in authorized) return authorized.response;
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "That delivery is not available." }, { status: 404 });
  let delivery;
  try { delivery = await pollDelivery(authorized.auth.orgId, id); }
  catch (error) {
    if (error instanceof PublishRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The delivery could not be checked." }, { status: 503 });
  }
  if (!delivery) return NextResponse.json({ error: "That delivery is not available." }, { status: 404 });
  const mock = isMockPostId(delivery.providerPostId);
  return NextResponse.json({
    id: delivery.id,
    destination: delivery.destination,
    status: mock && delivery.status !== "FAILED" ? "SIMULATED" : delivery.status,
    providerPostId: mock ? null : delivery.providerPostId,
    error: delivery.lastError,
    attemptCount: delivery.attemptCount,
    mock,
    publishedAt: mock ? null : delivery.publishedAt,
  });
}
