import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo";
import { authorizePublishing } from "@/lib/publishing/http";
import { encryptionKey } from "@/lib/publishing/connection-store";
import { finishGoogle } from "@/lib/publishing/connect-account";
import { googleRedirectUri } from "@/lib/publishing/oauth";
import { OAUTH_STATE_COOKIE, verifyOauthState } from "@/lib/publishing/oauth-state";

export async function GET(request: Request) {
  if (isDemoMode()) return NextResponse.redirect(new URL("/marketing/connections?result=preview", request.url));
  const authorized = await authorizePublishing();
  const url = new URL(request.url);
  if ("response" in authorized) return NextResponse.redirect(new URL("/login", request.url));
  const done = (code: string) => {
    const response = NextResponse.redirect(new URL(`/marketing/connections?result=${code}`, request.url));
    response.cookies.set(OAUTH_STATE_COOKIE, "", { httpOnly: true, path: "/api/publishing/callback", maxAge: 0 });
    return response;
  };
  if (url.searchParams.get("error")) return done("oauth-denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return done("oauth-error");
  const nonce = (await cookies()).get(OAUTH_STATE_COOKIE)?.value ?? "";
  let secret = "";
  try {
    secret = encryptionKey();
  } catch {
    return done("missing-configuration");
  }
  const verified = verifyOauthState(state, secret, { nonce, orgId: authorized.auth.orgId, userId: authorized.auth.userId });
  if (!verified.ok || (verified.flow !== "google_business" && verified.flow !== "google_ads")) return done("oauth-mismatch");
  try {
    const result = await finishGoogle({
      orgId: authorized.auth.orgId,
      userId: authorized.auth.userId,
      code,
      redirectUri: googleRedirectUri(process.env),
      flow: verified.flow,
    });
    return done(result.chooseAccount ? "choose-account" : "connected");
  } catch {
    return done("oauth-error");
  }
}
