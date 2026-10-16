import { classifyMetaError } from "@/lib/publishing/provider-errors";
import { readProviderJson, stringField } from "@/lib/publishing/redact";
import type { OrganicPublisher, ProviderOutcome } from "@/lib/publishing/types";

function containerIdOf(value: string | null) {
  return value?.startsWith("igcontainer:") ? value.slice("igcontainer:".length) : null;
}

function childIdsOf(value: string | null) {
  return value?.startsWith("igchildren:") ? value.slice("igchildren:".length).split(",").filter(Boolean) : [];
}

async function graph(fetchImpl: typeof fetch, url: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  const response = await fetchImpl(url, { ...init, headers });
  const payload = await readProviderJson(response);
  return { response, payload };
}

export function createInstagramPublisher(fetchImpl: typeof fetch, version: string): OrganicPublisher {
  return {
    async publish(input) {
      const igId = encodeURIComponent(input.externalAccountId);
      const existingContainer = containerIdOf(input.containerId);
      if (existingContainer) return publishContainer(fetchImpl, version, igId, existingContainer, input.accessToken);

      const children = childIdsOf(input.containerId);
      if (children.length === 0) {
        for (const url of input.mediaUrls) {
          const params = new URLSearchParams({ image_url: url });
          if (input.mediaUrls.length > 1) params.set("is_carousel_item", "true");
          else params.set("caption", input.text);
          const created = await graph(fetchImpl, `https://graph.facebook.com/${version}/${igId}/media`, input.accessToken, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params,
          });
          if (!created.response.ok) return classifyMetaError(created.response.status, created.payload);
          const id = stringField(created.payload, "id");
          if (!id) return { outcome: "failed", message: "Instagram did not return a media container.", retryable: true, containerId: children.length ? `igchildren:${children.join(",")}` : undefined };
          children.push(id);
        }
      }

      let container = children[0];
      if (input.mediaUrls.length > 1) {
        const params = new URLSearchParams({
          media_type: "CAROUSEL",
          children: children.join(","),
          caption: input.text,
        });
        const carousel = await graph(fetchImpl, `https://graph.facebook.com/${version}/${igId}/media`, input.accessToken, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params,
        });
        if (!carousel.response.ok) {
          const failed = classifyMetaError(carousel.response.status, carousel.payload);
          return failed.outcome === "failed" ? { ...failed, containerId: `igchildren:${children.join(",")}` } : failed;
        }
        container = stringField(carousel.payload, "id") ?? "";
        if (!container) {
          return { outcome: "failed", message: "Instagram did not return a carousel container.", retryable: true, containerId: `igchildren:${children.join(",")}` };
        }
      }
      return finishContainer(fetchImpl, version, igId, container, input.accessToken);
    },
    poll(input) {
      const igId = encodeURIComponent(input.externalAccountId);
      const container = containerIdOf(input.containerId) ?? input.providerPostId;
      if (!container) return Promise.resolve({ outcome: "failed", message: "Instagram has no container to check.", retryable: true });
      return finishContainer(fetchImpl, version, igId, container, input.accessToken);
    },
  };
}

async function publishContainer(fetchImpl: typeof fetch, version: string, igId: string, container: string, token: string) {
  return finishContainer(fetchImpl, version, igId, container, token);
}

async function finishContainer(fetchImpl: typeof fetch, version: string, igId: string, container: string, token: string): Promise<ProviderOutcome> {
  const status = await graph(
    fetchImpl,
    `https://graph.facebook.com/${version}/${encodeURIComponent(container)}?fields=status_code`,
    token,
  );
  if (!status.response.ok) return classifyMetaError(status.response.status, status.payload);
  const code = stringField(status.payload, "status_code");
  if (code === "IN_PROGRESS") return { outcome: "processing", containerId: `igcontainer:${container}` };
  if (code === "ERROR" || code === "EXPIRED") {
    return { outcome: "failed", message: "Instagram could not process the photo.", retryable: code === "ERROR", containerId: `igcontainer:${container}` };
  }
  if (code !== "FINISHED" && code !== "PUBLISHED") {
    return { outcome: "accepted", containerId: `igcontainer:${container}` };
  }
  if (code === "PUBLISHED") return { outcome: "published", providerPostId: container, containerId: `igcontainer:${container}` };

  const published = await graph(fetchImpl, `https://graph.facebook.com/${version}/${igId}/media_publish`, token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ creation_id: container }),
  });
  if (!published.response.ok) {
    const failed = classifyMetaError(published.response.status, published.payload);
    return failed.outcome === "failed" ? { ...failed, containerId: `igcontainer:${container}` } : failed;
  }
  const mediaId = stringField(published.payload, "id");
  if (!mediaId) return { outcome: "processing", containerId: `igcontainer:${container}` };
  return { outcome: "published", providerPostId: mediaId, containerId: `igcontainer:${container}` };
}
