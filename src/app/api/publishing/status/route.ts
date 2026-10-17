import { NextResponse } from "next/server";
import { z } from "zod";
import { publishingStatus } from "@/lib/publishing/status";
import { authorizePublishing } from "@/lib/publishing/http";

export async function GET(request: Request) {
  const authorized = await authorizePublishing(request);
  if ("response" in authorized) return authorized.response;
  const draftId = new URL(request.url).searchParams.get("draftId");
  if (draftId !== null && !z.string().uuid().safeParse(draftId).success) {
    return NextResponse.json({ error: "Choose a valid saved draft." }, { status: 400 });
  }
  try {
    return NextResponse.json(await publishingStatus(authorized.auth.orgId, draftId ?? undefined), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Publishing readiness could not be checked. Try again." }, { status: 503 });
  }
}
