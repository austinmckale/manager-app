import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo";
import { authorizePublishing } from "@/lib/publishing/http";
import { missingCredentialNames, readPublishingEnv, PROVIDER_CATALOG } from "@/lib/publishing/config";
import { OAUTH_STATE_COOKIE, createOauthNonce, createOauthState } from "@/lib/publishing/oauth-state";
import { encryptionKey } from "@/lib/publishing/connection-store";
import { googleAuthorizeUrl, metaAuthorizeUrl, googleRedirectUri, metaRedirectUri } from "@/lib/publishing/oauth";
import type { MarketingProviderName, OauthFlow } from "@/lib/publishing/types";

const PROVIDERS = new Set<MarketingProviderName>(["FACEBOOK_PAGE", "INSTAGRAM", "GOOGLE_BUSINESS", "GOOGLE_ADS", "META_ADS"]);

export async function GET(request: Request) {
  if (isDemoMode()) {
    return NextResponse.redirect(new URL("/marketing/connections?result=preview", request.url));
  }
  const authorized = await authorizePublishing();
  if ("response" in authorized) return authorized.response;
  const provider = new URL(request.url).searchParams.get("provider");
  if (!provider || !PROVIDERS.has(provider as MarketingProviderName)) {
    return NextResponse.json({ error: "Choose a marketing account to connect." }, { status: 400 });
  }
  const name = provider as MarketingProviderName;
  const env = readPublishingEnv(process.env);
  const missing = missingCredentialNames(name, env);
  if (missing.length > 0) {
    return NextResponse.redirect(new URL(`/marketing/connections?result=missing-configuration&provider=${name}`, request.url));
  }
  let secret = "";
  try {
    secret = encryptionKey();
  } catch {
    return NextResponse.redirect(new URL("/marketing/connections?result=missing-configuration", request.url));
  }
  const flow: OauthFlow = PROVIDER_CATALOG[name].flow;
  const nonce = createOauthNonce();
  const state = createOauthState({ orgId: authorized.auth.orgId, userId: authorized.auth.userId, flow, nonce }, secret);
  const destination =
    flow === "google_business" || flow === "google_ads"
      ? googleAuthorizeUrl({
          clientId: process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "",
          redirectUri: googleRedirectUri(process.env),
          state,
          flow,
        })
      : metaAuthorizeUrl({
          appId: process.env.META_APP_ID?.trim() ?? "",
          redirectUri: metaRedirectUri(process.env),
          state,
          flow,
          version: env.graphVersion,
        });
  const response = NextResponse.redirect(destination);
  response.cookies.set(OAUTH_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/publishing/callback",
    maxAge: 600,
  });
  return response;
}
