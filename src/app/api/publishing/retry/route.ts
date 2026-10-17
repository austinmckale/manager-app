import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { retryRequestSchema } from "@/lib/publishing/api-schema";
import { executePublish } from "@/lib/publishing/execute";
import { authorizePublishing } from "@/lib/publishing/http";
import { PublishRejection, type OrganicDestination } from "@/lib/publishing/types";

const ORGANIC = new Set<OrganicDestination>(["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS"]);

export async function POST(request: Request) {
  const authorized = await authorizePublishing(request);
  if ("response" in authorized) return authorized.response;
  const parsed = retryRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a delivery to retry." }, { status: 400 });
  const delivery = await prisma.marketingDelivery.findFirst({
    where: { id: parsed.data.deliveryId, orgId: authorized.auth.orgId },
  });
  if (!delivery || !ORGANIC.has(delivery.destination as OrganicDestination)) {
    return NextResponse.json({ error: "That delivery is not available." }, { status: 404 });
  }
  try {
    const result = await executePublish({
      orgId: authorized.auth.orgId,
      userId: authorized.auth.userId,
      jobId: delivery.jobId,
      draftId: delivery.draftId,
      assetIds: delivery.assetIds,
      destinations: [delivery.destination as OrganicDestination],
      retry: { deliveryId: delivery.id, contentHash: delivery.contentHash, idempotencyKey: delivery.idempotencyKey },
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ ok: result.results.every((item) => item.status !== "FAILED"), mode: result.mode, results: result.results });
  } catch (error) {
    if (error instanceof PublishRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The delivery could not be retried." }, { status: 400 });
  }
}
