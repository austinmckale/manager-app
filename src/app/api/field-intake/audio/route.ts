import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveUploadInvite } from "@/lib/field-intake";
import { AUDIO_RECEIVED, audioNoteSchema, decodeAudioNote } from "@/lib/intake-audio";
import { isDemoMode } from "@/lib/demo";

export async function POST(request: Request) {
  if (isDemoMode()) return NextResponse.json({ error: "Preview only. Use the live upload link." }, { status: 409 });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = audioNoteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Please record your note again." }, { status: 400 });
  const body = parsed.data;
  try {
    const invite = await resolveUploadInvite(body.token);
    if (!invite) return NextResponse.json({ error: "Upload link unavailable. Ask for a new link." }, { status: 403 });
    const existing = await prisma.activityLog.findUnique({ where: { id: body.id } });
    const matchesSubmission = (row: typeof existing) => {
      const meta = row?.metadata as { inviteId?: string; submissionId?: string } | null;
      return row?.orgId === invite.orgId && row.jobId === invite.jobId && row.action === AUDIO_RECEIVED && meta?.inviteId === invite.id && meta.submissionId === body.submissionId;
    };
    if (existing) return matchesSubmission(existing) ? NextResponse.json({ ok: true, status: "queued" }) : NextResponse.json({ error: "Please record a new note." }, { status: 409 });
    const count = await prisma.activityLog.count({ where: { orgId: invite.orgId, action: AUDIO_RECEIVED, metadata: { path: ["inviteId"], equals: invite.id } } });
    if (count >= 300) return NextResponse.json({ error: "This link has reached its recording limit. Ask for a new link." }, { status: 429 });
    const bytes = decodeAudioNote(body);
    const extension = { "audio/mp4": "m4a", "audio/webm": "webm", "audio/ogg": "ogg", "audio/wav": "wav" }[body.mimeType];
    const storageKey = `${invite.orgId}/${invite.jobId}/intake/${invite.id}/voice-${body.id}.${extension}`;
    const { error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").upload(storageKey, bytes, { contentType: body.mimeType, upsert: true });
    if (error) return NextResponse.json({ error: "Voice note could not be sent. Keep this page open and retry." }, { status: 503 });
    try { await prisma.activityLog.create({ data: { id: body.id, orgId: invite.orgId, jobId: invite.jobId, action: AUDIO_RECEIVED, metadata: { inviteId: invite.id, submissionId: body.submissionId, storageKey, mimeType: body.mimeType, fileSize: bytes.length, status: "queued" } } }); }
    catch (error) {
      if (!(typeof error === "object" && error && "code" in error && error.code === "P2002")) throw error;
      if (!matchesSubmission(await prisma.activityLog.findUnique({ where: { id: body.id } }))) return NextResponse.json({ error: "Please record a new note." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, status: "queued" });
  } catch { return NextResponse.json({ error: "Could not send the recording. Keep this page open and retry." }, { status: 503 }); }
}
