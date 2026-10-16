import { NextResponse } from "next/server";
import { presentedConnections } from "@/lib/publishing/execute";
import { authorizePublishing } from "@/lib/publishing/http";

export async function GET() {
  const authorized = await authorizePublishing();
  if ("response" in authorized) return authorized.response;
  return NextResponse.json(await presentedConnections(authorized.auth.orgId));
}
