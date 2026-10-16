import { classifyGoogleError } from "@/lib/publishing/provider-errors";
import { readProviderJson, stringField } from "@/lib/publishing/redact";
import type { OrganicPublisher, ProviderOutcome } from "@/lib/publishing/types";

function fromLocalPost(payload: unknown): ProviderOutcome | null {
  const name = stringField(payload, "name");
  const state = stringField(payload, "state");
  if (!name) return null;
  if (state === "REJECTED") return { outcome: "failed", message: "Google rejected the Business Profile post.", retryable: false, providerPostId: name };
  if (state === "PROCESSING") return { outcome: "processing", providerPostId: name };
  return { outcome: "published", providerPostId: name };
}

async function googleFetch(fetchImpl: typeof fetch, url: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetchImpl(url, { ...init, headers });
  const payload = await readProviderJson(response);
  return { response, payload };
}

export function createGoogleBusinessPublisher(fetchImpl: typeof fetch): OrganicPublisher {
  return {
    async publish(input) {
      if (!input.externalAccountId.startsWith("accounts/") || !input.externalAccountId.includes("/locations/")) {
        return { outcome: "failed", message: "Choose a Google Business Profile location before posting.", retryable: false };
      }
      const body: Record<string, unknown> = {
        languageCode: "en-US",
        summary: input.text,
        topicType: "STANDARD",
      };
      if (input.mediaUrls[0]) body.media = [{ mediaFormat: "PHOTO", sourceUrl: input.mediaUrls[0] }];
      const created = await googleFetch(
        fetchImpl,
        `https://mybusiness.googleapis.com/v4/${input.externalAccountId}/localPosts`,
        input.accessToken,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
      );
      if (!created.response.ok) return classifyGoogleError(created.response.status, created.payload);
      return fromLocalPost(created.payload) ?? { outcome: "failed", message: "Google did not return a post id.", retryable: true };
    },
    async poll(input) {
      if (!input.providerPostId) return { outcome: "failed", message: "Google has no post to check.", retryable: true };
      const checked = await googleFetch(fetchImpl, `https://mybusiness.googleapis.com/v4/${input.providerPostId}`, input.accessToken);
      if (!checked.response.ok) return classifyGoogleError(checked.response.status, checked.payload);
      return fromLocalPost(checked.payload) ?? { outcome: "processing", providerPostId: input.providerPostId };
    },
  };
}
