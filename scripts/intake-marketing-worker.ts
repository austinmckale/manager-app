import { loadEnvFile } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomInt } from "node:crypto";
import { z } from "zod";

// This worker never sends mail or texts itself. The scheduled assistant uses its
// connected Gmail tool after claiming a due notification, then records its ID.
async function main() {
  const [command = "scan", ...args] = process.argv.slice(2);
  const envFile = process.env.INTAKE_WORKER_ENV_FILE || ".env.intake-production-verified";
  loadEnvFile(envFile);
  const { prisma } = await import("../src/lib/prisma");
  const { supabaseAdmin } = await import("../src/lib/supabase/admin");
  const { PHOTO_RECEIVED, uploadInviteToken, resolveUploadInvite } = await import("../src/lib/field-intake");
  const { INTAKE_PACK, INTAKE_EMAIL, packSchema, deliveryId, deliveryDate } = await import("../src/lib/intake-delivery");
  const { marketingDraftSchema, ARCHIVED_PHOTO_TAG, DRAFT_SAVED_ACTION } = await import("../src/lib/marketing");
  const { AUDIO_RECEIVED } = await import("../src/lib/intake-audio");
  const orgId = process.env.DEFAULT_ORG_ID;
  if (!orgId) throw new Error("Default organization required.");
  const folder = resolve(".vercel/intake-marketing-worker");
  await mkdir(folder, { recursive: true });
  const base = new URL(process.env.NEXT_PUBLIC_APP_URL || "https://app.rhipros.com");
  if (base.protocol !== "https:") throw new Error("Production HTTPS app URL required.");
  const receiptSchema = z.object({ inviteId: z.string().uuid(), submissionId: z.string().uuid(), fileAssetId: z.string().uuid(), location: z.string(), description: z.string() });
  const recipients = ["rhisolutions316@gmail.com", "austinmck17@gmail.com"];
  const now = new Date();
  async function source(inviteId: string, submissionId: string) {
    const invite = await resolveUploadInvite(uploadInviteToken(inviteId));
    if (!invite || invite.orgId !== orgId) throw new Error("Upload link inactive or wrong organization.");
    const assets = await prisma.fileAsset.findMany({ where: { tags: { hasEvery: [`intake:${inviteId}`, `submission:${submissionId}`] }, job: { orgId }, NOT: { tags: { has: ARCHIVED_PHOTO_TAG } } }, orderBy: { createdAt: "asc" } });
    if (!assets.length || assets.length > 24) throw new Error("Submission photos unavailable.");
    const audioRows = await prisma.activityLog.findMany({ where: { orgId, action: AUDIO_RECEIVED, metadata: { path: ["submissionId"], equals: submissionId } }, orderBy: { createdAt: "asc" }, take: 30 });
    const audio = audioRows.map((row) => row.metadata as { inviteId?: string; status?: string; transcript?: string }).filter((item) => item.inviteId === inviteId);
    if (audio.some((item) => item.status !== "transcribed")) throw new Error("Voice note is waiting for local transcription.");
    return { invite, assets, transcript: audio.map((item) => item.transcript || "").join("\n\n") };
  }
  try {
    if (command === "alerts") {
      const { runMarketingAlerts } = await import("../src/lib/marketing-alerts");
      console.log(JSON.stringify(await runMarketingAlerts(orgId, args.includes("--worker-failed") ? "failed" : args.includes("--worker-healthy") ? "healthy" : undefined, args.includes("--test"))));
    } else if (command === "run-local") {
      const { runLocalIntake } = await import("./local-intake-runner");
      await runLocalIntake({ prisma, supabaseAdmin, orgId, folder, audioAction: AUDIO_RECEIVED, includeTest: args.includes("--include-test") });
    } else if (command === "scan") {
      const rows = await prisma.activityLog.findMany({ where: { orgId, action: PHOTO_RECEIVED, createdAt: { gte: new Date(now.getTime() - 29 * 86400000) } }, orderBy: { createdAt: "desc" }, take: 2000 });
      const seen = new Set<string>();
      for (const row of rows) {
        const parsed = receiptSchema.safeParse(row.metadata);
        if (!parsed.success) continue;
        const receipt = parsed.data;
        const id = deliveryId(orgId, receipt.inviteId, receipt.submissionId);
        if (seen.has(id)) continue;
        seen.add(id);
        if (row.createdAt.getTime() > now.getTime() - 15 * 60000 && !(args.includes("--include-test") && /^TEST\b/i.test(receipt.description.trim()))) continue;
        if (!args.includes("--include-test") && /^TEST\b/i.test(receipt.description.trim())) continue;
        if (await prisma.activityLog.findUnique({ where: { id }, select: { id: true } })) continue;
        let batch;
        try { batch = await source(receipt.inviteId, receipt.submissionId); } catch { continue; }
        const batchFolder = join(folder, id);
        await mkdir(batchFolder, { recursive: true });
        const photos = [];
        for (const asset of batch.assets) {
          const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").download(asset.storageKey);
          if (error || !data) throw new Error("Could not retrieve source photo.");
          const path = join(batchFolder, `${asset.id}.jpg`);
          await writeFile(path, Buffer.from(await data.arrayBuffer()));
          photos.push({ id: asset.id, path, description: asset.description, stage: asset.stage, area: asset.area });
        }
        const input = { id, orgId, inviteId: receipt.inviteId, submissionId: receipt.submissionId, jobId: batch.invite.jobId, submittedAt: row.createdAt.toISOString(), location: receipt.location, description: receipt.description, transcript: batch.transcript, photos };
        const path = join(batchFolder, "source.json");
        await writeFile(path, JSON.stringify(input, null, 2));
        console.log(JSON.stringify({ pending: true, inputPath: path, input, outputPath: join(batchFolder, "finished.json") }));
        return;
      }
      console.log(JSON.stringify({ pending: false }));
    } else if (command === "save") {
      const input = JSON.parse(await readFile(args[0], "utf8"));
      const inviteId = z.string().uuid().parse(input.inviteId);
      const submissionId = z.string().uuid().parse(input.submissionId);
      const id = deliveryId(orgId, inviteId, submissionId);
      const existing = await prisma.activityLog.findUnique({ where: { id } });
      if (existing) { console.log(JSON.stringify({ saved: true, duplicate: true, id })); return; }
      const batch = await source(inviteId, submissionId);
      const draft = marketingDraftSchema.parse(input.draft);
      const ids = new Set(batch.assets.map((asset) => asset.id));
      if (new Set(draft.assetIds).size !== draft.assetIds.length || draft.assetIds.some((assetId) => !ids.has(assetId))) throw new Error("A selected photo is outside this submission.");
      const landing = new URL(draft.landingUrl);
      if (!["rhipros.com", "www.rhipros.com"].includes(landing.hostname)) throw new Error("Use an RHI Pros landing page.");
      const rows = await prisma.activityLog.findMany({ where: { orgId, action: PHOTO_RECEIVED, metadata: { path: ["submissionId"], equals: submissionId } }, orderBy: { createdAt: "desc" }, take: 30 });
      const receipt = rows.find((row) => receiptSchema.safeParse(row.metadata).success && receiptSchema.parse(row.metadata).inviteId === inviteId);
      if (!receipt) throw new Error("Submission receipt unavailable.");
      const selected = batch.assets.filter((asset) => draft.assetIds.includes(asset.id));
      draft.sourceNotes = [...selected.map((asset) => asset.description || ""), batch.transcript].filter(Boolean).join("\n\n").slice(0, 6000);
      draft.photoNotes = selected.map((asset) => ({ assetId: asset.id, description: asset.description || "", stage: asset.stage, area: asset.area }));
      const deliverAt = deliveryDate(receipt.createdAt, randomInt(600, 2521));
      if (new Date(deliverAt) >= new Date(batch.invite.expiresAt)) throw new Error("Upload link expires before delivery. Renew it first.");
      const metadata = packSchema.parse({ inviteId, submissionId, deliverAt, draft, generator: input.generator, isTest: /^TEST\b/i.test(receiptSchema.parse(receipt.metadata).description.trim()) });
      const admin = await prisma.userProfile.findFirst({ where: { orgId, isActive: true, role: "ADMIN", fullName: "Austin McKale" }, select: { id: true } });
      if (!admin) throw new Error("Active app administrator required.");
      const draftId = deliveryId(orgId, inviteId, submissionId, "saved-draft");
      try {
        await prisma.$transaction([
          prisma.activityLog.create({ data: { id, orgId, jobId: batch.invite.jobId, actorId: admin.id, action: INTAKE_PACK, metadata } }),
          prisma.activityLog.create({ data: { id: draftId, orgId, jobId: batch.invite.jobId, actorId: admin.id, action: DRAFT_SAVED_ACTION, metadata: draft } }),
        ]);
      } catch (error) {
        if (!(typeof error === "object" && error && "code" in error && error.code === "P2002")) throw error;
      }
      console.log(JSON.stringify({ saved: true, id, draftId, deliverAt, url: `${base.origin}/send-photos/${uploadInviteToken(inviteId)}/packs/${id}` }));
    } else if (command === "due" || command === "claim-email" || command === "record-email") {
      if (command !== "record-email" && process.env.INTAKE_EMAIL_SENDING !== "enabled") { console.log(JSON.stringify({ due: [], claimed: false, email: "disabled — test and finalize the approval workflow first", sms: "not configured" })); return; }
      if (command === "record-email") {
        const id = z.string().uuid().parse(args[0]);
        const providerMessageId = z.string().min(1).max(200).parse(args[1]);
        const claim = await prisma.activityLog.findFirst({ where: { id, orgId, action: INTAKE_EMAIL } });
        if (!claim) throw new Error("Email claim unavailable.");
        await prisma.activityLog.update({ where: { id }, data: { metadata: { ...(claim.metadata as object), status: "accepted", providerMessageId, acceptedAt: now.toISOString() } } });
        console.log(JSON.stringify({ recorded: true })); return;
      }
      const rows = await prisma.activityLog.findMany({ where: { orgId, action: INTAKE_PACK }, orderBy: { createdAt: "asc" }, take: 1000 });
      const due = [];
      for (const row of rows) {
        if (command === "claim-email" && row.id !== args[0]) continue;
        const parsed = packSchema.safeParse(row.metadata);
        if (!parsed.success || new Date(parsed.data.deliverAt) > now) continue;
        const pack = parsed.data;
        if (pack.isTest || !pack.ownerApproved) continue;
        const token = uploadInviteToken(pack.inviteId);
        if (!await resolveUploadInvite(token)) continue;
        const claimId = deliveryId(orgId, pack.inviteId, pack.submissionId, "email");
        const existing = await prisma.activityLog.findUnique({ where: { id: claimId } });
        if (existing) continue;
        const url = `${base.origin}/send-photos/${token}/packs/${row.id}`;
        const message = { packId: row.id, claimId, to: recipients, subject: `Your RHI Pros photo pack is ready: ${pack.draft.packName || "Job photos"}`, body: `Your job photo pack is ready.\n\n${url}\n\nOpen it to copy your Facebook or Google post, download photos and branded graphics, or use the ad copy options. You choose what to post.\n\nYou can also find it under Ready to post in your photo upload app.\n\nRHI Pros marketing` };
        if (command === "claim-email") {
          try { await prisma.activityLog.create({ data: { id: claimId, orgId, jobId: row.jobId, action: INTAKE_EMAIL, metadata: { packId: row.id, status: "claimed", claimedAt: now.toISOString(), to: recipients } } }); }
          catch (error) { if (typeof error === "object" && error && "code" in error && error.code === "P2002") { console.log(JSON.stringify({ claimed: false })); return; } throw error; }
          console.log(JSON.stringify({ claimed: true, message })); return;
        }
        due.push(message);
      }
      console.log(JSON.stringify(command === "claim-email" ? { claimed: false } : { due, sms: "not configured" }));
    } else throw new Error("Commands: scan [--include-test], save <file>, due, claim-email <pack-id>, record-email <claim-id> <provider-message-id>");
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Worker failed"); process.exitCode = 1; });
