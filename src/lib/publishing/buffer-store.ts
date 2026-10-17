import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadApprovedPublishingDraft } from "@/lib/publishing/approval";
import { bufferSelectionId, discoverBufferChannels, createBufferPost, readBufferPost, type BufferChannel } from "@/lib/publishing/buffer";
import { BUFFER_DELIVERY, BUFFER_TEST_TEXT, BUFFER_TEST_IMAGE_URL, bufferDeliveryId, postPatch, sendApprovedToBuffer, type BufferDelivery, type BufferSendCommand } from "@/lib/publishing/buffer-delivery";
import { PublishRejection } from "@/lib/publishing/types";

function json(record: BufferDelivery): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(record)); }
export async function savedBufferChannels(orgId: string) {
  const row = await prisma.activityLog.findFirst({ where: { id: bufferSelectionId(orgId), orgId } });
  return (row?.metadata as { channels?: BufferChannel[] } | null)?.channels || [];
}
export async function activeBufferChannels(orgId: string) {
  const saved = await savedBufferChannels(orgId);
  const live = await discoverBufferChannels(process.env.BUFFER_API_KEY || "");
  return live.filter((channel) => saved.some((s) => s.id === channel.id));
}
export async function bufferDeliveries(orgId: string, draftId?: string) {
  const rows = await prisma.activityLog.findMany({ where: { orgId, action: BUFFER_DELIVERY, ...(draftId ? { metadata: { path: ["draftId"], equals: draftId } } : {}) }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((row) => row.metadata as unknown as BufferDelivery);
}
function store(orgId: string, userId: string, jobId?: string) {
  async function find(id: string) {
    const row = await prisma.activityLog.findFirst({ where: { id, orgId, action: BUFFER_DELIVERY } });
    return row ? row.metadata as unknown as BufferDelivery : null;
  }
  return {
    find,
    async claim(record: BufferDelivery) {
      try {
        await prisma.activityLog.create({ data: { id: record.id, orgId, actorId: userId, jobId, action: BUFFER_DELIVERY, metadata: json(record) } });
        return { owned: true, record };
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;
        const existing = await find(record.id);
        if (!existing) throw error;
        return { owned: false, record: existing };
      }
    },
    async update(id: string, patch: Partial<BufferDelivery>) {
      const current = await find(id);
      if (!current) throw new Error("Delivery unavailable.");
      const updated = { ...current, ...patch };
      await prisma.activityLog.updateMany({ where: { id, orgId, action: BUFFER_DELIVERY }, data: { metadata: json(updated) } });
      return updated;
    },
  };
}
export async function executeBufferSend(command: BufferSendCommand, userId: string) {
  const initial = await loadApprovedPublishingDraft(command.orgId, command.draftId);
  const db = store(command.orgId, userId, initial.jobId);
  return sendApprovedToBuffer(command, {
    async approved() { const record = await loadApprovedPublishingDraft(command.orgId, command.draftId); return { inputHash: record.approvalHash, draft: record.metadata }; },
    channels: () => activeBufferChannels(command.orgId),
    async media(ids, service) {
      const assets = await prisma.fileAsset.findMany({ where: { id: { in: ids }, type: "PHOTO", jobId: initial.jobId, job: { orgId: command.orgId } } });
      if (assets.length !== ids.length || assets.some((asset) => asset.tags.includes("marketing:archived") || !/^image\/(jpeg|png|webp)$/.test(asset.mimeType || "") || (asset.fileSize || 0) > (service === "instagram" ? 8 : 10) * 1024 * 1024)) throw new Error("Photos unavailable or unsupported.");
      const bucket = supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET || "job-assets");
      const urls: string[] = [];
      for (const id of ids) {
        const asset = assets.find((a) => a.id === id)!;
        const signed = await bucket.createSignedUrl(asset.storageKey, 604800);
        if (signed.error || !signed.data?.signedUrl) throw new Error("Photo unavailable.");
        urls.push(signed.data.signedUrl);
      }
      return urls;
    },
    claim: db.claim, update: db.update,
    create: (input) => createBufferPost(input, process.env.BUFFER_API_KEY || ""),
  });
}
export async function refreshBufferDelivery(orgId: string, userId: string, id: string) {
  const db = store(orgId, userId);
  const record = await db.find(id);
  if (!record?.postId) throw new PublishRejection("No Buffer post ID is available. Inspect Buffer manually; do not resend an unconfirmed attempt.", 409);
  const post = await readBufferPost(record.postId, process.env.BUFFER_API_KEY || "");
  if (post.channelId !== record.channelId) throw new Error("Channel mismatch.");
  return db.update(id, postPatch(post));
}
export async function testBufferDraft(orgId: string, userId: string) {
  const channels = (await activeBufferChannels(orgId)).filter((c) => ["facebook", "googlebusiness"].includes(c.service) && !c.isDisconnected && !c.isLocked).slice(0, 3);
  if (!channels.length) throw new PublishRejection("Save an available Facebook or Google Business channel before testing.", 409);
  const results: BufferDelivery[] = [];
  for (const channel of channels) results.push(await testChannelDraft(orgId, userId, channel));
  return results;
}
async function testChannelDraft(orgId: string, userId: string, channel: BufferChannel) {
  const db = store(orgId, userId);
  const id = bufferDeliveryId(orgId, "connection-test", "v2-image", channel.id);
  const claim = await db.claim({ id, draftId: null, inputHash: "test-v1", channelId: channel.id, channelName: channel.displayName || channel.name, service: channel.service, mode: "draft", assetIds: [], status: "unknown", postId: null, dueAt: null, sentAt: null, externalLink: null, message: "Test pending. Do not repeat if its outcome is unknown.", checkedAt: new Date().toISOString() });
  if (!claim.owned) {
    if (claim.record.postId) return refreshBufferDelivery(orgId, userId, id);
    return claim.record;
  }
  try {
    const post = await createBufferPost({ channel, text: BUFFER_TEST_TEXT, imageUrls: [BUFFER_TEST_IMAGE_URL], mode: "draft" }, process.env.BUFFER_API_KEY || "");
    await db.update(id, { postId: post.id });
    const checked = await readBufferPost(post.id, process.env.BUFFER_API_KEY || "");
    if (checked.status !== "draft" || checked.text !== BUFFER_TEST_TEXT || checked.channelId !== channel.id || checked.assets.length !== 1 || !checked.assets[0].mimeType.startsWith("image/")) throw new Error("Unexpected test result.");
    return db.update(id, { ...postPatch(checked), message: "Verified: Buffer created and returned the private test draft with RHI's public brand image. No post was scheduled or published." });
  } catch {
    return db.update(id, { status: "unknown", message: "The draft test could not be confirmed. Check Buffer drafts; automatic repeat creation is blocked." });
  }
}
