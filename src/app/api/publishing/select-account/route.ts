import { NextResponse } from "next/server";
import { selectAccountSchema } from "@/lib/publishing/api-schema";
import { selectConnectedAccount } from "@/lib/publishing/connect-account";
import { authorizePublishing } from "@/lib/publishing/http";

export async function POST(request: Request) {
  const authorized = await authorizePublishing(request);
  if ("response" in authorized) return authorized.response;
  const parsed = selectAccountSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose an account from the list." }, { status: 400 });
  const result = await selectConnectedAccount({ orgId: authorized.auth.orgId, userId: authorized.auth.userId, ...parsed.data });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, status: result.status, note: result.note });
}
