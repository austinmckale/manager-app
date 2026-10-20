import { createHash } from "node:crypto";
import type { MarketingDraft } from "@/lib/marketing";
import { BufferRejected, type BufferChannel, type BufferPost } from "@/lib/publishing/buffer";
import { PublishRejection } from "@/lib/publishing/types";

export const BUFFER_DELIVERY = "marketing.buffer.delivery";
export const BUFFER_TEST_TEXT = "RHI Pros integration test — private draft only. Do not publish. This confirms the RHI app can create and read a Buffer draft.";
export const BUFFER_TEST_IMAGE_URL = "https://rhipros.com/images/brand/rhi-pros-share.png";
export type BufferDelivery = { id: string; draftId: string | null; inputHash: string; channelId: string; channelName: string; service: string; mode: "draft" | "queue"; assetIds: string[]; status: "preparing" | "unknown" | "rejected" | "draft" | "queued" | "sending" | "published" | "failed" | "needs_approval"; postId: string | null; dueAt: string | null; sentAt: string | null; externalLink: string | null; message: string; checkedAt: string };
export function bufferDeliveryId(orgId: string, draftId: string, inputHash: string, channelId: string) {
  const hex = createHash("sha256").update(JSON.stringify(["rhi-buffer-v1", orgId, draftId, inputHash, channelId])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function bufferStatus(post: BufferPost): BufferDelivery["status"] {
  if (post.status === "sent" && post.sentAt) return "published";
  // Buffer's docs also call a queued post "buffer" (createPost's saveToDraft), so both mean queued.
  return ({ draft: "draft", scheduled: "queued", buffer: "queued", sending: "sending", error: "failed", needs_approval: "needs_approval" } as const)[post.status] || "unknown";
}
export function postPatch(post: BufferPost): Partial<BufferDelivery> {
  const status = bufferStatus(post);
  const externalLink = post.externalLink && /^https:\/\//.test(post.externalLink) ? post.externalLink : null;
  return { status, postId: post.id, dueAt: post.dueAt, sentAt: post.sentAt, externalLink, checkedAt: new Date().toISOString(), message: status === "failed" ? "Buffer reports a publishing failure. Open Buffer to resolve it." : status === "unknown" ? "Delivery is not confirmed. Check this post in Buffer." : "" };
}
export type BufferSendCommand = { orgId: string; draftId: string; inputHash: string; mode: "draft" | "queue"; selections: { channelId: string; assetIds: string[] }[] };
export type BufferSendDeps = {
  approved: () => Promise<{ inputHash: string; draft: MarketingDraft }>;
  channels: () => Promise<BufferChannel[]>;
  media: (ids: string[], service: string) => Promise<string[]>;
  claim: (record: BufferDelivery) => Promise<{ owned: boolean; record: BufferDelivery }>;
  update: (id: string, patch: Partial<BufferDelivery>) => Promise<BufferDelivery>;
  create: (input: { channel: BufferChannel; text: string; imageUrls: string[]; mode: "draft" | "queue" }) => Promise<BufferPost>;
};
export async function sendApprovedToBuffer(command: BufferSendCommand, deps: BufferSendDeps) {
  const approved = await deps.approved();
  if (approved.inputHash !== command.inputHash) throw new PublishRejection("The approved version changed. Reload and review it again.", 409);
  const channels = await deps.channels();
  const selections = command.selections;
  if (!selections.length || selections.length > 20 || new Set(selections.map((s) => s.channelId)).size !== selections.length) throw new PublishRejection("Choose each channel once.", 400);
  // Validate every destination before creating any post.
  const prepared = selections.map((selection) => {
    const channel = channels.find((c) => c.id === selection.channelId);
    if (!channel || channel.isDisconnected || channel.isLocked) throw new PublishRejection("A selected Buffer channel is unavailable. Check the connection.", 409);
    if (command.mode === "queue" && channel.isQueuePaused) throw new PublishRejection("This channel's Buffer queue is paused. Resume it in Buffer first.", 409);
    const ids = selection.assetIds;
    const max = channel.service === "googlebusiness" ? 1 : 10;
    if (!ids.length || ids.length > max || new Set(ids).size !== ids.length || ids.some((id) => !approved.draft.assetIds.includes(id))) throw new PublishRejection(`Choose 1–${max} approved photos for ${channel.displayName || channel.name}.`, 400);
    const text = channel.service === "googlebusiness" ? approved.draft.googleBusiness : approved.draft.social;
    if (!text.trim()) throw new PublishRejection("The approved post text is empty.", 400);
    return { channel, ids, text };
  });
  const results: BufferDelivery[] = [];
  for (const { channel, ids, text } of prepared) {
    const record: BufferDelivery = { id: bufferDeliveryId(command.orgId, command.draftId, command.inputHash, channel.id), draftId: command.draftId, inputHash: command.inputHash, channelId: channel.id, channelName: channel.displayName || channel.name, service: channel.service, mode: command.mode, assetIds: ids, status: "preparing", postId: null, dueAt: null, sentAt: null, externalLink: null, message: "Preparing delivery. Do not resend while this attempt is pending.", checkedAt: new Date().toISOString() };
    const claim = await deps.claim(record);
    if (!claim.owned) { results.push(claim.record); continue; }
    let mutationStarted = false;
    try {
      const imageUrls = await deps.media(ids, channel.service);
      const current = await deps.approved();
      if (current.inputHash !== command.inputHash) throw new Error("Approval changed.");
      // Persist ambiguity BEFORE calling the provider. A crash/timeout must never auto-create a duplicate.
      await deps.update(record.id, { status: "unknown", message: "Checking Buffer response. Do not resend; inspect Buffer if this remains unconfirmed." });
      mutationStarted = true;
      const post = await deps.create({ channel, text, imageUrls, mode: command.mode });
      if (post.channelId !== channel.id || post.text !== text || post.assets.length !== ids.length) {
        results.push(await deps.update(record.id, { ...postPatch(post), status: "unknown", message: "Buffer returned different content or media. Inspect the saved post in Buffer before proceeding." }));
      } else results.push(await deps.update(record.id, postPatch(post)));
    } catch (error) {
      results.push(await deps.update(record.id, { status: !mutationStarted || error instanceof BufferRejected ? "rejected" : "unknown", message: mutationStarted ? "Delivery could not be confirmed. Check Buffer before trying anything else; automatic retries are blocked to prevent duplicates." : "Photos or approval changed, or media preparation failed. Nothing was sent for this channel." }));
    }
  }
  return results;
}
