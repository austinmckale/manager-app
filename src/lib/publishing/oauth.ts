import { appBaseUrl, scopesForFlow } from "@/lib/publishing/config";
import type { OauthFlow } from "@/lib/publishing/types";
import { redactSecrets, readProviderJson, stringField } from "@/lib/publishing/redact";

export type FetchLike = typeof fetch;

export function metaRedirectUri(source: Record<string, string | undefined>) {
  return `${appBaseUrl(source)}/api/publishing/callback/meta`;
}

export function googleRedirectUri(source: Record<string, string | undefined>) {
  return `${appBaseUrl(source)}/api/publishing/callback/google`;
}

export function metaAuthorizeUrl(input: { appId: string; redirectUri: string; state: string; flow: OauthFlow; version: string }) {
  const url = new URL(`https://www.facebook.com/${input.version}/dialog/oauth`);
  url.searchParams.set("client_id", input.appId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopesForFlow(input.flow).join(","));
  return url.toString();
}

export function googleAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string; flow: OauthFlow }) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("scope", scopesForFlow(input.flow).join(" "));
  return url.toString();
}

async function postForm(fetchImpl: FetchLike, url: string, body: URLSearchParams) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const payload = await readProviderJson(response);
  if (!response.ok) {
    throw new Error(redactSecrets(`Authorization could not be completed (${response.status}).`));
  }
  return payload;
}

export async function exchangeMetaCode(input: {
  fetchImpl: FetchLike;
  version: string;
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}) {
  const shortLived = await postForm(
    input.fetchImpl,
    `https://graph.facebook.com/${input.version}/oauth/access_token`,
    new URLSearchParams({
      client_id: input.appId,
      client_secret: input.appSecret,
      redirect_uri: input.redirectUri,
      code: input.code,
    }),
  );
  const shortToken = stringField(shortLived, "access_token");
  if (!shortToken) throw new Error("Meta did not return an authorization token.");
  const longLived = await postForm(
    input.fetchImpl,
    `https://graph.facebook.com/${input.version}/oauth/access_token`,
    new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: input.appId,
      client_secret: input.appSecret,
      fb_exchange_token: shortToken,
    }),
  );
  const accessToken = stringField(longLived, "access_token");
  if (!accessToken) throw new Error("Meta did not return a long-lived authorization token.");
  const expiresIn = numberField(longLived, "expires_in") ?? 60 * 24 * 60 * 60;
  return { accessToken, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

export async function metaGrantedScopes(input: { fetchImpl: FetchLike; version: string; appId: string; appSecret: string; accessToken: string }) {
  const url = new URL(`https://graph.facebook.com/${input.version}/debug_token`);
  url.searchParams.set("input_token", input.accessToken);
  const response = await input.fetchImpl(url, { headers: { Authorization: `Bearer ${input.appId}|${input.appSecret}` } });
  const payload = await readProviderJson(response);
  if (!response.ok) return [];
  const data = payload && typeof payload === "object" && "data" in payload ? (payload as { data?: { scopes?: unknown } }).data : undefined;
  return Array.isArray(data?.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [];
}

export type MetaPageCandidate = { id: string; name: string; accessToken: string; instagramId: string | null; instagramName: string | null };

export async function listMetaPages(input: { fetchImpl: FetchLike; version: string; userToken: string }): Promise<MetaPageCandidate[]> {
  const url = new URL(`https://graph.facebook.com/${input.version}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  const response = await input.fetchImpl(url, { headers: { Authorization: `Bearer ${input.userToken}` } });
  const payload = await readProviderJson(response);
  if (!response.ok || !payload || typeof payload !== "object" || !("data" in payload) || !Array.isArray((payload as { data?: unknown }).data)) {
    return [];
  }
  return (payload as { data: unknown[] }).data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = stringField(item, "id");
    const name = stringField(item, "name");
    const accessToken = stringField(item, "access_token");
    if (!id || !name || !accessToken) return [];
    const ig = "instagram_business_account" in item ? (item as { instagram_business_account?: unknown }).instagram_business_account : null;
    const instagramId = ig && typeof ig === "object" ? stringField(ig, "id") : null;
    const instagramName = ig && typeof ig === "object" ? stringField(ig, "username") : null;
    return [{ id, name, accessToken, instagramId, instagramName }];
  });
}

export async function listMetaAdAccounts(input: { fetchImpl: FetchLike; version: string; userToken: string }) {
  const url = new URL(`https://graph.facebook.com/${input.version}/me/adaccounts`);
  url.searchParams.set("fields", "id,name,account_status");
  const response = await input.fetchImpl(url, { headers: { Authorization: `Bearer ${input.userToken}` } });
  const payload = await readProviderJson(response);
  if (!response.ok || !payload || typeof payload !== "object" || !Array.isArray((payload as { data?: unknown }).data)) return [];
  return (payload as { data: unknown[] }).data.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = stringField(item, "id");
    const name = stringField(item, "name") ?? id;
    if (!id || !name) return [];
    return [{ id, name }];
  });
}

export async function exchangeGoogleCode(input: { fetchImpl: FetchLike; clientId: string; clientSecret: string; redirectUri: string; code: string }) {
  const payload = await postForm(
    input.fetchImpl,
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: "authorization_code",
    }),
  );
  const accessToken = stringField(payload, "access_token");
  if (!accessToken) throw new Error("Google did not return an authorization token.");
  const refreshToken = stringField(payload, "refresh_token");
  const expiresIn = numberField(payload, "expires_in") ?? 3600;
  const scope = stringField(payload, "scope")?.split(" ").filter(Boolean) ?? [];
  return { accessToken, refreshToken, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(), scopes: scope };
}

export async function refreshGoogleAccessToken(input: { fetchImpl: FetchLike; clientId: string; clientSecret: string; refreshToken: string }) {
  const payload = await postForm(
    input.fetchImpl,
    "https://oauth2.googleapis.com/token",
    new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  );
  const accessToken = stringField(payload, "access_token");
  if (!accessToken) return null;
  const expiresIn = numberField(payload, "expires_in") ?? 3600;
  return { accessToken, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
}

export async function listGoogleLocations(fetchImpl: FetchLike, accessToken: string) {
  const accountsResponse = await fetchImpl("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const accountsPayload = await readProviderJson(accountsResponse);
  if (!accountsResponse.ok || !accountsPayload || typeof accountsPayload !== "object") return [];
  const accounts = Array.isArray((accountsPayload as { accounts?: unknown }).accounts) ? (accountsPayload as { accounts: unknown[] }).accounts : [];
  const locations: { id: string; name: string }[] = [];
  for (const account of accounts) {
    const accountName = account && typeof account === "object" ? stringField(account, "name") : null;
    if (!accountName) continue;
    const response = await fetchImpl(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title&pageSize=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = await readProviderJson(response);
    const rows = payload && typeof payload === "object" && Array.isArray((payload as { locations?: unknown }).locations)
      ? (payload as { locations: unknown[] }).locations
      : [];
    for (const location of rows) {
      if (!location || typeof location !== "object") continue;
      const name = stringField(location, "name");
      const title = stringField(location, "title") ?? name;
      if (name && title) locations.push({ id: name, name: title });
    }
  }
  return locations;
}

export async function listGoogleAdsCustomers(fetchImpl: FetchLike, accessToken: string, version: string) {
  const response = await fetchImpl(`https://googleads.googleapis.com/${version}/customers:listAccessibleCustomers`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const payload = await readProviderJson(response);
  const names = payload && typeof payload === "object" && Array.isArray((payload as { resourceNames?: unknown }).resourceNames)
    ? (payload as { resourceNames: unknown[] }).resourceNames
    : [];
  return names.flatMap((name) => {
    if (typeof name !== "string") return [];
    const id = name.replace("customers/", "");
    if (!/^\d{10}$/.test(id)) return [];
    return [{ id, name: `Google Ads ${id}` }];
  });
}

function numberField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}
