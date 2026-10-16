import { readPublishingEnv } from "@/lib/publishing/config";
import { presentConnection } from "@/lib/publishing/connections";
import { clearConnection, encryptionKey, openSeal, readConnections, seal, toSecret, upsertConnection } from "@/lib/publishing/connection-store";
import {
  exchangeGoogleCode,
  exchangeMetaCode,
  listGoogleAdsCustomers,
  listGoogleLocations,
  listMetaAdAccounts,
  listMetaPages,
  metaGrantedScopes,
  type MetaPageCandidate,
} from "@/lib/publishing/oauth";
import type { MarketingProviderName } from "@/lib/publishing/types";

type PageCatalog = { kind: "meta-pages"; pages: MetaPageCandidate[]; userToken: string };

function statusFor(provider: MarketingProviderName, partial: Parameters<typeof presentConnection>[1]) {
  const env = readPublishingEnv(process.env);
  return presentConnection(provider, partial, env, new Date());
}

export async function finishMetaOrganic(input: { orgId: string; userId: string; code: string; redirectUri: string }) {
  const appId = process.env.META_APP_ID?.trim() ?? "";
  const appSecret = process.env.META_APP_SECRET?.trim() ?? "";
  const env = readPublishingEnv(process.env);
  const token = await exchangeMetaCode({ fetchImpl: fetch, version: env.graphVersion, appId, appSecret, redirectUri: input.redirectUri, code: input.code });
  const scopes = await metaGrantedScopes({ fetchImpl: fetch, version: env.graphVersion, appId, appSecret, accessToken: token.accessToken });
  const pages = await listMetaPages({ fetchImpl: fetch, version: env.graphVersion, userToken: token.accessToken });
  const catalog = JSON.stringify({ kind: "meta-pages", pages, userToken: token.accessToken } satisfies PageCatalog);
  const pageCandidates = pages.map((page) => ({ id: page.id, name: page.name }));
  const igCandidates = pages.flatMap((page) => (page.instagramId ? [{ id: page.instagramId, name: page.instagramName ? `@${page.instagramName}` : page.name }] : []));
  const chosenPage = pages.length === 1 ? pages[0] : null;
  const chosenIg = igCandidates.length === 1 ? pages.find((page) => page.instagramId === igCandidates[0]?.id) ?? null : null;

  await saveMetaRow({
    ...input,
    provider: "FACEBOOK_PAGE",
    scopes,
    catalog,
    userToken: token.accessToken,
    expiresAt: token.expiresAt,
    candidates: pageCandidates,
    selected: chosenPage ? { id: chosenPage.id, name: chosenPage.name, accessToken: chosenPage.accessToken } : null,
  });
  await saveMetaRow({
    ...input,
    provider: "INSTAGRAM",
    scopes,
    catalog,
    userToken: token.accessToken,
    expiresAt: token.expiresAt,
    candidates: igCandidates,
    selected: chosenIg?.instagramId ? { id: chosenIg.instagramId, name: chosenIg.instagramName ? `@${chosenIg.instagramName}` : chosenIg.name, accessToken: chosenIg.accessToken } : null,
  });
  return { chooseAccount: !chosenPage || igCandidates.length === 0 };
}

export async function finishMetaAds(input: { orgId: string; userId: string; code: string; redirectUri: string }) {
  const appId = process.env.META_APP_ID?.trim() ?? "";
  const appSecret = process.env.META_APP_SECRET?.trim() ?? "";
  const env = readPublishingEnv(process.env);
  const token = await exchangeMetaCode({ fetchImpl: fetch, version: env.graphVersion, appId, appSecret, redirectUri: input.redirectUri, code: input.code });
  const scopes = await metaGrantedScopes({ fetchImpl: fetch, version: env.graphVersion, appId, appSecret, accessToken: token.accessToken });
  const accounts = await listMetaAdAccounts({ fetchImpl: fetch, version: env.graphVersion, userToken: token.accessToken });
  const selected = accounts.length === 1 ? accounts[0] : null;
  const presented = statusFor("META_ADS", {
    provider: "META_ADS",
    status: "CONNECTED",
    accessToken: token.accessToken,
    refreshToken: token.accessToken,
    tokenExpiresAt: token.expiresAt,
    externalAccountId: selected?.id ?? null,
    externalAccountName: selected?.name ?? null,
    scopes,
    lastError: null,
    approvalNote: null,
    candidates: accounts,
  });
  await upsertConnection({
    orgId: input.orgId,
    userId: input.userId,
    provider: "META_ADS",
    status: presented.status,
    externalAccountId: selected?.id ?? null,
    externalAccountName: selected?.name ?? null,
    scopes,
    accessToken: token.accessToken,
    refreshToken: token.accessToken,
    catalog: JSON.stringify({ kind: "meta-ads", userToken: token.accessToken }),
    tokenExpiresAt: token.expiresAt,
    approvalNote: presented.note,
    candidates: accounts,
  });
  return { chooseAccount: !selected };
}

export async function finishGoogle(input: { orgId: string; userId: string; code: string; redirectUri: string; flow: "google_business" | "google_ads" }) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() ?? "";
  const env = readPublishingEnv(process.env);
  const token = await exchangeGoogleCode({ fetchImpl: fetch, clientId, clientSecret, redirectUri: input.redirectUri, code: input.code });
  const provider = input.flow === "google_business" ? "GOOGLE_BUSINESS" : "GOOGLE_ADS";
  const candidates =
    provider === "GOOGLE_BUSINESS"
      ? await listGoogleLocations(fetch, token.accessToken).catch(() => [])
      : await listGoogleAdsCustomers(fetch, token.accessToken, env.googleAdsVersion).catch(() => []);
  const selected = candidates.length === 1 ? candidates[0] : null;
  const presented = statusFor(provider, {
    provider,
    status: "CONNECTED",
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    tokenExpiresAt: token.expiresAt,
    externalAccountId: selected?.id ?? null,
    externalAccountName: selected?.name ?? null,
    scopes: token.scopes,
    lastError: null,
    approvalNote: null,
    candidates,
  });
  await upsertConnection({
    orgId: input.orgId,
    userId: input.userId,
    provider,
    status: presented.status,
    externalAccountId: selected?.id ?? null,
    externalAccountName: selected?.name ?? null,
    scopes: token.scopes,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    catalog: JSON.stringify({ kind: provider === "GOOGLE_BUSINESS" ? "google-business" : "google-ads" }),
    tokenExpiresAt: token.expiresAt,
    approvalNote: presented.note,
    candidates,
  });
  return { chooseAccount: !selected };
}

async function saveMetaRow(input: {
  orgId: string;
  userId: string;
  provider: "FACEBOOK_PAGE" | "INSTAGRAM";
  scopes: string[];
  catalog: string;
  userToken: string;
  expiresAt: string;
  candidates: { id: string; name: string }[];
  selected: { id: string; name: string; accessToken: string } | null;
}) {
  const presented = statusFor(input.provider, {
    provider: input.provider,
    status: "CONNECTED",
    accessToken: input.selected?.accessToken ?? input.userToken,
    refreshToken: input.userToken,
    tokenExpiresAt: input.expiresAt,
    externalAccountId: input.selected?.id ?? null,
    externalAccountName: input.selected?.name ?? null,
    scopes: input.scopes,
    lastError: null,
    approvalNote: null,
    candidates: input.candidates,
  });
  await upsertConnection({
    orgId: input.orgId,
    userId: input.userId,
    provider: input.provider,
    status: presented.status,
    externalAccountId: input.selected?.id ?? null,
    externalAccountName: input.selected?.name ?? null,
    scopes: input.scopes,
    accessToken: input.selected?.accessToken ?? null,
    refreshToken: input.userToken,
    catalog: input.catalog,
    tokenExpiresAt: input.expiresAt,
    approvalNote: presented.note,
    candidates: input.candidates,
  });
}

export async function selectConnectedAccount(input: { orgId: string; userId: string; provider: MarketingProviderName; externalAccountId: string }) {
  const rows = await readConnections(input.orgId);
  const row = rows?.find((item) => item.provider === input.provider);
  if (!row) return { error: "Connect the account before choosing a destination." };
  const candidates = toSecret(row).candidates;
  const candidate = candidates.find((item) => item.id === input.externalAccountId);
  if (!candidate) return { error: "That account is not available for this connection." };
  const catalogText = openSeal(row.accountCatalogCipher);
  let accessToken = openSeal(row.accessTokenCipher);
  if (catalogText) {
    try {
      const catalog = JSON.parse(catalogText) as PageCatalog | { kind: string };
      if (catalog.kind === "meta-pages" && "pages" in catalog) {
        const page =
          input.provider === "FACEBOOK_PAGE"
            ? catalog.pages.find((item) => item.id === candidate.id)
            : catalog.pages.find((item) => item.instagramId === candidate.id);
        accessToken = page?.accessToken ?? null;
      }
    } catch {
      return { error: "Reconnect the account, then choose it again." };
    }
  }
  if (!accessToken) return { error: "Reconnect the account, then choose it again." };
  const secret = toSecret(row);
  const presented = statusFor(input.provider, {
    ...secret,
    accessToken,
    externalAccountId: candidate.id,
    externalAccountName: candidate.name,
    status: "CONNECTED",
    lastError: null,
  });
  await upsertConnection({
    orgId: input.orgId,
    userId: input.userId,
    provider: input.provider,
    status: presented.status,
    externalAccountId: candidate.id,
    externalAccountName: candidate.name,
    scopes: secret.scopes,
    accessToken,
    refreshToken: secret.refreshToken,
    catalog: catalogText,
    tokenExpiresAt: secret.tokenExpiresAt,
    approvalNote: presented.note,
    candidates,
  });
  return { status: presented.status, note: presented.note };
}

export async function disconnectProvider(orgId: string, provider: MarketingProviderName) {
  const rows = await readConnections(orgId);
  const row = rows?.find((item) => item.provider === provider);
  const token = row ? openSeal(row.refreshTokenCipher) ?? openSeal(row.accessTokenCipher) : null;
  let note = "Disconnected.";
  if (token) {
    const revoked = await revokeToken(provider, token);
    if (!revoked) note = "Disconnected in this app. The provider revoke did not complete.";
  }
  await clearConnection(orgId, provider, note);
  return { note };
}

async function revokeToken(provider: MarketingProviderName, token: string) {
  try {
    if (provider === "GOOGLE_BUSINESS" || provider === "GOOGLE_ADS") {
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      return response.ok;
    }
    const version = readPublishingEnv(process.env).graphVersion;
    const response = await fetch(`https://graph.facebook.com/${version}/me/permissions`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function assertEncryptionConfigured() {
  encryptionKey();
  return seal("ok") !== null;
}
