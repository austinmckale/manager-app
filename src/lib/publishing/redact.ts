export function redactSecrets(value: string) {
  return value
    .replace(/access_token=[^&\s]+/gi, "access_token=redacted")
    .replace(/refresh_token=[^&\s]+/gi, "refresh_token=redacted")
    .replace(/client_secret=[^&\s]+/gi, "client_secret=redacted")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, "Bearer redacted")
    .replace(/EAAC[A-Za-z0-9]+/g, "redacted");
}

export async function readProviderJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { unparsed: true };
  }
}

export function stringField(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) return null;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.trim() ? field : null;
}
