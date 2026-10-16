import { classifyMetaError } from "@/lib/publishing/provider-errors";
import { readProviderJson, stringField } from "@/lib/publishing/redact";
import type { OrganicPublisher } from "@/lib/publishing/types";

type PhotoFile = { bytes: Uint8Array; mimeType: string; fileName: string };

async function graphPost(fetchImpl: typeof fetch, url: string, token: string, body: FormData | string) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (typeof body === "string") headers.set("Content-Type", "application/json");
  const response = await fetchImpl(url, { method: "POST", headers, body });
  const payload = await readProviderJson(response);
  return { response, payload };
}

export function createFacebookPublisher(
  fetchImpl: typeof fetch,
  version: string,
  loadBytes: (assetId: string) => Promise<PhotoFile>,
): OrganicPublisher {
  return {
    async publish(input) {
      const pageId = encodeURIComponent(input.externalAccountId);
      let photoIds: string[] = [];
      if (input.containerId?.startsWith("fbphotos:")) {
        photoIds = input.containerId.slice("fbphotos:".length).split(",").filter(Boolean);
      } else {
        for (const assetId of input.assetIds) {
          const file = await loadBytes(assetId);
          const form = new FormData();
          form.set("published", "false");
          form.set("source", new Blob([Buffer.from(file.bytes)], { type: file.mimeType }), file.fileName);
          const uploaded = await graphPost(fetchImpl, `https://graph.facebook.com/${version}/${pageId}/photos`, input.accessToken, form);
          if (!uploaded.response.ok) {
            const failed = classifyMetaError(uploaded.response.status, uploaded.payload);
            return failed.outcome === "failed" && photoIds.length > 0
              ? { ...failed, containerId: `fbphotos:${photoIds.join(",")}` }
              : failed;
          }
          const id = stringField(uploaded.payload, "id");
          if (!id) {
            return {
              outcome: "failed",
              message: "Facebook did not return a photo id.",
              retryable: true,
              containerId: photoIds.length ? `fbphotos:${photoIds.join(",")}` : undefined,
            };
          }
          photoIds.push(id);
        }
      }

      const posted = await graphPost(
        fetchImpl,
        `https://graph.facebook.com/${version}/${pageId}/feed`,
        input.accessToken,
        JSON.stringify({ message: input.text, attached_media: photoIds.map((id) => ({ media_fbid: id })) }),
      );
      if (!posted.response.ok) {
        const failed = classifyMetaError(posted.response.status, posted.payload);
        return failed.outcome === "failed" ? { ...failed, containerId: `fbphotos:${photoIds.join(",")}` } : failed;
      }
      const postId = stringField(posted.payload, "id");
      if (!postId) {
        return {
          outcome: "failed",
          message: "Facebook did not return a post id.",
          retryable: true,
          containerId: `fbphotos:${photoIds.join(",")}`,
        };
      }
      return { outcome: "published", providerPostId: postId, containerId: `fbphotos:${photoIds.join(",")}` };
    },
  };
}
