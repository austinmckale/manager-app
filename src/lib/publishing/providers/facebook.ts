import { createHash } from "node:crypto";
import { classifyMetaError } from "@/lib/publishing/provider-errors";
import { encodeFacebookState, facebookRetryBlocker, readFacebookState, type FacebookResumeState } from "@/lib/publishing/providers/facebook-state";
import { readProviderJson, stringField } from "@/lib/publishing/redact";
import { PublishRejection, type OrganicPublisher, type ProviderOutcome } from "@/lib/publishing/types";

type PhotoFile = { bytes: Uint8Array; mimeType: string; fileName: string };

async function graphPost(fetchImpl: typeof fetch, url: string, token: string, body: FormData | string) {
  const headers = new Headers({ Authorization: `Bearer ${token}` });
  if (typeof body === "string") headers.set("Content-Type", "application/json");
  const response = await fetchImpl(url, { method: "POST", headers, body, signal: AbortSignal.timeout(60_000) });
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
      const fail = (message: string, retryable: boolean, state?: FacebookResumeState): ProviderOutcome => ({
        outcome: "failed", message, retryable, ...(state ? { containerId: encodeFacebookState(state) } : {}),
      });
      const blocked = facebookRetryBlocker(input.containerId);
      if (blocked) return { outcome: "failed", message: blocked, retryable: false, containerId: input.containerId! };
      if (input.providerPostId) return fail("This delivery already has a Facebook post id. Check the Page instead of reposting.", false);
      if (!input.assetIds.length || input.assetIds.length > 10 || new Set(input.assetIds).size !== input.assetIds.length) {
        return fail("Choose between one and ten different approved photos.", false);
      }
      const fingerprint = createHash("sha256").update(JSON.stringify({
        page: input.externalAccountId, key: input.idempotencyKey, text: input.text, assets: [...input.assetIds].sort(),
      })).digest("hex");
      let state: FacebookResumeState = readFacebookState(input.containerId) ?? { version: 1, fingerprint, phase: "uploading", photos: [] };
      if (state.fingerprint !== fingerprint || state.photos.some((photo) => !input.assetIds.includes(photo.assetId)) ||
          new Set(state.photos.map((photo) => photo.assetId)).size !== state.photos.length ||
          new Set(state.photos.map((photo) => photo.photoId)).size !== state.photos.length) {
        return fail("The Facebook upload record does not match this approved content and Page. Check the existing delivery.", false, state);
      }
      // Without durable checkpoints a process interruption could create duplicate posts.
      if (!input.checkpoint) return fail("Delivery progress cannot be saved. Facebook publishing is blocked until storage is available.", true, state);
      const checkpoint = input.checkpoint;
      const pageId = encodeURIComponent(input.externalAccountId);
      try {
        for (const assetId of input.assetIds) {
          if (state.photos.some((photo) => photo.assetId === assetId)) continue;
          const file = await loadBytes(assetId);
          const form = new FormData();
          form.set("published", "false");
          form.set("source", new Blob([Buffer.from(file.bytes)], { type: file.mimeType }), file.fileName);
          const uploaded = await graphPost(fetchImpl, `https://graph.facebook.com/${version}/${pageId}/photos`, input.accessToken, form);
          if (!uploaded.response.ok) {
            const failed = classifyMetaError(uploaded.response.status, uploaded.payload);
            return { ...failed, containerId: encodeFacebookState(state) };
          }
          const id = stringField(uploaded.payload, "id");
          if (!id || !/^[A-Za-z0-9_-]+$/.test(id) || state.photos.some((photo) => photo.photoId === id)) {
            return fail("Facebook did not return a unique photo id. No feed post was submitted.", true, state);
          }
          state = { ...state, photos: [...state.photos, { assetId, photoId: id }] };
          await checkpoint(encodeFacebookState(state));
        }
      } catch (error) {
        if (error instanceof PublishRejection) throw error;
        return fail("A Facebook photo upload could not finish. Retry to resume the remaining photos; no feed post was submitted.", true, state);
      }

      const pending: FacebookResumeState = { ...state, phase: "feed_pending" };
      try {
        // Persist uncertainty BEFORE sending the public request, including crash recovery.
        await checkpoint(encodeFacebookState(pending));
      } catch (error) {
        if (error instanceof PublishRejection) throw error;
        return fail("Delivery progress could not be saved. No Facebook feed post was submitted.", true, state);
      }
      try {
        const posted = await graphPost(
          fetchImpl,
          `https://graph.facebook.com/${version}/${pageId}/feed`,
          input.accessToken,
          JSON.stringify({ message: input.text, attached_media: input.assetIds.map((id) => ({ media_fbid: state.photos.find((photo) => photo.assetId === id)!.photoId })) }),
        );
        if (!posted.response.ok && posted.response.status < 500 && typeof posted.payload === "object" && posted.payload !== null && "error" in posted.payload) {
          // A definite API rejection is safe to retry; a server/network failure is ambiguous.
          const failed = classifyMetaError(posted.response.status, posted.payload);
          return { ...failed, containerId: encodeFacebookState(state) };
        }
        const postId = posted.response.ok ? stringField(posted.payload, "id") : null;
        if (postId) return { outcome: "published", providerPostId: postId, containerId: encodeFacebookState(pending) };
      } catch {
        // Do not retry an ambiguous POST. Facebook may already have published it.
      }
      return fail(facebookRetryBlocker(encodeFacebookState(pending))!, false, pending);
    },
  };
}
