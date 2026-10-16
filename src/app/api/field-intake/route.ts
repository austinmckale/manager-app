import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/demo";
import { decodeIntakePhoto, intakePhotoSchema, PHOTO_RECEIVED, resolveUploadInvite } from "@/lib/field-intake";

export async function POST(request: Request) {
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Use the live upload link to send photos." }, { status: 409 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Please open your photo upload link again." }, { status: 403 });
  const parsed = intakePhotoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please check the photo and notes, then try again." }, { status: 400 });
  const body = parsed.data;
  try {
    const invite = await resolveUploadInvite(body.token);
    if (!invite) return NextResponse.json({ error: "This upload link has expired or been disabled. Ask for a new link." }, { status: 403 });
    const inviteTag = `intake:${invite.id}`;
    const existing = await prisma.fileAsset.findFirst({ where: { id: body.id, tags: { has: inviteTag }, job: { orgId: invite.orgId } }, select: { id: true } });
    if (existing) return NextResponse.json({ ok: true, id: existing.id });
    const count = await prisma.fileAsset.count({ where: { tags: { has: inviteTag }, job: { orgId: invite.orgId } } });
    if (count >= 300) return NextResponse.json({ error: "This link has reached its photo limit. Ask for a new link." }, { status: 429 });
    const payload = decodeIntakePhoto(body.dataUrl);
    const storageKey = `${invite.orgId}/${invite.jobId}/intake/${invite.id}/${body.id}.jpg`;
    const { error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").upload(storageKey, payload, { contentType: "image/jpeg", upsert: true });
    if (error) return NextResponse.json({ error: "The photo could not be sent. It is still saved on this device; please retry." }, { status: 503 });
    const note = [body.location ? `Town / job: ${body.location}` : "", body.description].filter(Boolean).join("\n\n");
    await prisma.$transaction([
      prisma.fileAsset.create({ data: { id: body.id, jobId: invite.jobId, type: "PHOTO", storageKey, fileName: `${body.fileName.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 150)}.jpg`, mimeType: "image/jpeg", fileSize: payload.length, takenAt: new Date(), stage: body.stage, description: note || null, tags: [inviteTag, `submission:${body.submissionId}`, "capture:crew"], isPortfolio: false, isClientVisible: false } }),
      prisma.activityLog.create({ data: { orgId: invite.orgId, jobId: invite.jobId, action: PHOTO_RECEIVED, metadata: { inviteId: invite.id, submissionId: body.submissionId, fileAssetId: body.id, location: body.location, description: body.description, stage: body.stage } } }),
    ]);
    revalidatePath("/marketing");
    return NextResponse.json({ ok: true, id: body.id });
  } catch {
    return NextResponse.json({ error: "Could not finish sending this photo. Keep this screen open and retry." }, { status: 503 });
  }
}
