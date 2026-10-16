import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AuthContext } from "@/lib/auth";
import { canManageOrg } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const INVITE_CREATED = "field.invite.created";
export const INVITE_REVOKED = "field.invite.revoked";
export const PHOTO_RECEIVED = "field.photo.received";
const inviteMetadata = z.object({ expiresAt: z.string().datetime(), label: z.string().max(80) });
const idSchema = z.string().uuid();

function sign(id: string) {
  const secret = process.env.FIELD_INTAKE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Photo intake is not configured.");
  return createHmac("sha256", secret).update(`rhi-field-intake-v1:${id}`).digest("base64url");
}
export function uploadInviteToken(id: string) { return `${id}.${sign(id)}`; }

export async function resolveUploadInvite(token: string) {
  const [id, signature, extra] = token.split(".");
  if (extra || !idSchema.safeParse(id).success || !signature || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return null;
  let expected: string;
  try { expected = sign(id); } catch { return null; }
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const record = await prisma.activityLog.findFirst({ where: { id, action: INVITE_CREATED }, include: { job: { select: { id: true, orgId: true } } } });
  const metadata = inviteMetadata.safeParse(record?.metadata);
  if (!record || !metadata.success || !record.job || record.job.orgId !== record.orgId || new Date(metadata.data.expiresAt).getTime() <= Date.now()) return null;
  const revoked = await prisma.activityLog.findFirst({ where: { orgId: record.orgId, action: INVITE_REVOKED, metadata: { path: ["inviteId"], equals: id } }, select: { id: true } });
  return revoked ? null : { id, orgId: record.orgId, jobId: record.job.id, expiresAt: metadata.data.expiresAt };
}

export async function createUploadInvite(auth: AuthContext) {
  if (!canManageOrg(auth.role)) throw new Error("Only an owner or admin can create an upload link.");
  // Check configuration before creating any records.
  sign("configuration-check");
  let job = await prisma.job.findFirst({ where: { orgId: auth.orgId, categoryTags: { has: "photo-dump" } }, select: { id: true } });
  if (!job) {
    const customer = await prisma.customer.findFirst({ where: { orgId: auth.orgId, name: "Photo Dump" }, select: { id: true } }) ?? await prisma.customer.create({ data: { orgId: auth.orgId, name: "Photo Dump", notes: "Unassigned field photo inbox." }, select: { id: true } });
    job = await prisma.job.create({ data: { orgId: auth.orgId, customerId: customer.id, jobName: "Photo Dump", address: "Unassigned capture", status: "IN_PROGRESS", categoryTags: ["general-remodeling", "photo-dump"] }, select: { id: true } });
  }
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const invite = await prisma.activityLog.create({ data: { orgId: auth.orgId, actorId: auth.userId, jobId: job.id, action: INVITE_CREATED, metadata: { label: "Ryan’s photo upload", expiresAt } } });
  return { id: invite.id, token: uploadInviteToken(invite.id), expiresAt };
}

export const intakePhotoSchema = z.object({
  token: z.string().max(150), id: z.string().uuid(), submissionId: z.string().uuid(),
  location: z.string().trim().max(150), description: z.string().trim().max(2000),
  stage: z.enum(["BEFORE", "DURING", "AFTER"]).nullable(),
  fileName: z.string().min(1).max(200), dataUrl: z.string().startsWith("data:image/jpeg;base64,").max(4000000),
});
export type IntakePhotoInput = z.infer<typeof intakePhotoSchema>;

export function decodeIntakePhoto(dataUrl: string) {
  const payload = Buffer.from(dataUrl.split(",")[1] ?? "", "base64");
  if (payload.length < 3 || payload.length > 2.8 * 1024 * 1024 || payload[0] !== 0xff || payload[1] !== 0xd8 || payload[2] !== 0xff) throw new Error("Choose a valid photo and try again.");
  return payload;
}
