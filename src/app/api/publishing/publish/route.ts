import { NextResponse } from "next/server";
import { publishRequestSchema } from "@/lib/publishing/api-schema";
import { executePublish } from "@/lib/publishing/execute";
import { authorizePublishing } from "@/lib/publishing/http";
import { PublishRejection } from "@/lib/publishing/types";

export async function POST(request: Request) {
  const authorized = await authorizePublishing(request);
  if ("response" in authorized) return authorized.response;
  const parsed = publishRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the draft, photos, and destinations. Remote image links are not accepted." }, { status: 400 });
  try {
    const result = await executePublish({ orgId: authorized.auth.orgId, userId: authorized.auth.userId, ...parsed.data });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({
      ok: result.results.every((item) => item.status === "SIMULATED" || item.status === "PUBLISHED" || item.status === "PROCESSING" || item.status === "ACCEPTED"),
      mode: result.mode,
      results: result.results,
    });
  } catch (error) {
    if (error instanceof PublishRejection) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "The post could not be sent. Try again." }, { status: 400 });
  }
}
