import { NextResponse } from "next/server";
import { disconnectRequestSchema } from "@/lib/publishing/api-schema";
import { disconnectProvider } from "@/lib/publishing/connect-account";
import { authorizePublishing } from "@/lib/publishing/http";

export async function POST(request: Request) {
  const authorized = await authorizePublishing(request);
  if ("response" in authorized) return authorized.response;
  const parsed = disconnectRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an account to disconnect." }, { status: 400 });
  const result = await disconnectProvider(authorized.auth.orgId, parsed.data.provider);
  return NextResponse.json({ ok: true, note: result.note });
}
