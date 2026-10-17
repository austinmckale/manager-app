import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { marketingDraftSchema } from "@/lib/marketing";
import { resolveUploadInvite } from "@/lib/field-intake";

export const INTAKE_PACK = "marketing.intake.pack.ready";
export const INTAKE_EMAIL = "marketing.intake.pack.email";
export const packSchema = z.object({
  inviteId: z.string().uuid(), submissionId: z.string().uuid(),
  deliverAt: z.string().datetime(), draft: marketingDraftSchema,
  generator: z.enum(["local-ollama", "codex", "claude", "codex-and-claude", "owner"]),
  isTest: z.boolean().default(false),
  ownerApproved: z.boolean().default(false),
});
export type IntakePack = z.infer<typeof packSchema>;

// The same submission always has one delivery record. Retrying never rerolls its date.
export function deliveryId(orgId: string, inviteId: string, submissionId: string, kind = "pack") {
  const hex = createHash("sha256").update(`rhi-intake-delivery-v1:${orgId}:${inviteId}:${submissionId}:${kind}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}
export function deliveryDate(submittedAt: Date, minutes: number) {
  if (!Number.isInteger(minutes) || minutes < 600 || minutes > 2520) throw new Error("Delivery window must be 10–42 hours.");
  return new Date(submittedAt.getTime() + minutes * 60000).toISOString();
}
export function clientCopy(draft: IntakePack["draft"]) {
  // Original notes, private addresses and internal photo annotations never leave the owner workspace.
  return { ...draft, sourceNotes: "", photoNotes: [] };
}
export async function availableIntakePacks(token: string, now = new Date()) {
  const invite = await resolveUploadInvite(token);
  if (!invite) return [];
  const records = await prisma.activityLog.findMany({ where: { orgId: invite.orgId, action: INTAKE_PACK, metadata: { path: ["inviteId"], equals: invite.id } }, orderBy: { createdAt: "desc" }, take: 100 });
  return records.flatMap((record) => {
    const parsed = packSchema.safeParse(record.metadata);
    if (!parsed.success || !parsed.data.ownerApproved || parsed.data.isTest || parsed.data.inviteId !== invite.id || new Date(parsed.data.deliverAt) > now) return [];
    return [{ id: record.id, name: parsed.data.draft.packName || "Your job photo pack", deliverAt: parsed.data.deliverAt }];
  });
}
export async function readIntakePack(token: string, id: string, now = new Date()) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const invite = await resolveUploadInvite(token);
  if (!invite) return null;
  const record = await prisma.activityLog.findFirst({ where: { id, orgId: invite.orgId, action: INTAKE_PACK } });
  const parsed = packSchema.safeParse(record?.metadata);
  if (!record || !parsed.success || !parsed.data.ownerApproved || parsed.data.isTest || parsed.data.inviteId !== invite.id || new Date(parsed.data.deliverAt) > now) return null;
  const assets = await prisma.fileAsset.findMany({ where: { id: { in: parsed.data.draft.assetIds }, tags: { has: `intake:${invite.id}` }, job: { orgId: invite.orgId } }, select: { id: true, fileName: true, mimeType: true, storageKey: true } });
  if (assets.length !== new Set(parsed.data.draft.assetIds).size) return null;
  const ordered = parsed.data.draft.assetIds.map((assetId) => assets.find((asset) => asset.id === assetId)!);
  return { id: record.id, draft: clientCopy(parsed.data.draft), photos: ordered, jobId: record.jobId ?? invite.jobId };
}

export async function availableMembershipPacks(scope: { orgId: string; jobId: string; historyInviteIds: string[] }, now = new Date()) {
  const inviteIds = scope.historyInviteIds.filter((id) => z.string().uuid().safeParse(id).success);
  if (!inviteIds.length) return [];
  const allowed = new Set(inviteIds);
  const records = await prisma.activityLog.findMany({ where: { orgId: scope.orgId, jobId: scope.jobId, action: INTAKE_PACK }, orderBy: { createdAt: "desc" }, take: 100 });
  return records.flatMap((record) => {
    const parsed = packSchema.safeParse(record.metadata);
    if (!parsed.success || !parsed.data.ownerApproved || parsed.data.isTest || !allowed.has(parsed.data.inviteId) || new Date(parsed.data.deliverAt) > now) return [];
    return [{ id: record.id, name: parsed.data.draft.packName || "Your job photo pack", deliverAt: parsed.data.deliverAt }];
  });
}

export async function readMembershipPack(scope: { orgId: string; jobId: string; historyInviteIds: string[] }, id: string, now = new Date()) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const allowed = new Set(scope.historyInviteIds);
  const record = await prisma.activityLog.findFirst({ where: { id, orgId: scope.orgId, jobId: scope.jobId, action: INTAKE_PACK } });
  const parsed = packSchema.safeParse(record?.metadata);
  if (!record || !parsed.success || !parsed.data.ownerApproved || parsed.data.isTest || !allowed.has(parsed.data.inviteId) || new Date(parsed.data.deliverAt) > now) return null;
  const assets = await prisma.fileAsset.findMany({ where: { id: { in: parsed.data.draft.assetIds }, jobId: scope.jobId, job: { orgId: scope.orgId }, OR: [...allowed].map((inviteId) => ({ tags: { has: `intake:${inviteId}` } })) }, select: { id: true, fileName: true, mimeType: true, storageKey: true } });
  if (assets.length !== new Set(parsed.data.draft.assetIds).size) return null;
  const ordered = parsed.data.draft.assetIds.map((assetId) => assets.find((asset) => asset.id === assetId)!);
  return { id: record.id, draft: clientCopy(parsed.data.draft), photos: ordered, jobId: record.jobId ?? scope.jobId };
}
