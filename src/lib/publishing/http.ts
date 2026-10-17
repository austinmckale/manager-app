import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { isDemoMode } from "@/lib/demo";
import { marketingAccessDenied } from "@/lib/publishing/access";
import { isDashboardOwnerEmail } from "@/lib/client-portal-policy";

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

export async function authorizePublishing(request?: Request) {
  if (request && !sameOrigin(request)) {
    return { response: NextResponse.json({ error: "Invalid request origin." }, { status: 403 }) };
  }
  if (isDemoMode()) {
    return { response: NextResponse.json({ error: "This is a preview. Nothing has been connected or published." }, { status: 409 }) };
  }
  try {
    const auth = await requireAuth({ allowFallback: false });
    if (!isDashboardOwnerEmail(auth.email)) return { response: NextResponse.json({ error: "Owner access required." }, { status: 403 }) };
    const denied = marketingAccessDenied(auth.role);
    if (denied) return { response: NextResponse.json({ error: denied }, { status: 403 }) };
    return { auth };
  } catch {
    return { response: NextResponse.json({ error: "Sign in again to continue." }, { status: 401 }) };
  }
}

export function isMissingRelation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && ((error as { code?: string }).code === "P2021" || (error as { code?: string }).code === "P2022");
}
