import { loadEnvFile } from "node:process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { existsSync } from "node:fs";

// This worker never sends mail or texts itself. The scheduled assistant uses its
// connected Gmail tool after claiming a due notification, then records its ID.
async function main() {
  const [command = "scan", ...args] = process.argv.slice(2);
  const envFile = process.env.INTAKE_WORKER_ENV_FILE || ".env.intake-production-verified";
  if (existsSync(".env.marketing-ai.local")) loadEnvFile(".env.marketing-ai.local");
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
  const { ownerEmailRecipients, ownerSendDecision, OWNER_NOTIFY_PHONE } = await import("../src/lib/owner-notify");
  const recipients = ownerEmailRecipients();
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
      const { processingSettings, processingId, workerHeartbeat } = await import("../src/lib/marketing-processing");
      const { listRunnableOwnerLocalJobs, ownerLocalRunPlan, deferQueuedOwnerJobs, ownerSourceStillMatches, holdChangedOwnerSource } = await import("./local-generation-queue");
      const settings = await processingSettings(prisma, orgId);
      const ownerJobs = await listRunnableOwnerLocalJobs(prisma, orgId, now);
      const plan = ownerLocalRunPlan(settings, ownerJobs);
      if (plan.ownerSubmissionIds.length) {
        await workerHeartbeat(prisma, orgId, "processing", "local");
        try {
          for (const job of plan.ownerJobs) {
            if (job.sourceHash && job.inviteId) {
              const current = await source(job.inviteId, job.submissionId);
              if (!ownerSourceStillMatches(job.sourceHash, current.assets.map((asset) => asset.id))) {
                await holdChangedOwnerSource(prisma, orgId, job.inviteId, job.submissionId);
                continue;
              }
            }
            await runLocalIntake({ prisma, supabaseAdmin, orgId, folder, audioAction: AUDIO_RECEIVED, includeTest: true, mode: plan.ownerEngine, testOnce: true, reviewOnly: false, reviewDraftId: "00000000-0000-4000-8000-000000000000", testSubmissionId: job.submissionId });
          }
          if (plan.deferOwnerJobsBeforeHybrid) await deferQueuedOwnerJobs(prisma, orgId);
        } catch (error) { await workerHeartbeat(prisma, orgId, "error", "local"); throw error; }
      }
      if (plan.automaticPaused) {
        await workerHeartbeat(prisma, orgId, plan.ownerSubmissionIds.length ? "idle" : "paused", plan.ownerSubmissionIds.length ? "local" : settings.mode);
        if (!plan.ownerSubmissionIds.length) console.log(JSON.stringify({ transcribed: 0, generated: false, paused: true }));
        return;
      }
      const testOnce = plan.testOnce;
      if (testOnce) {
        const row = await prisma.activityLog.findUnique({ where: { id: processingId(orgId, "settings") } });
        if (!row) throw new Error("Settings changed.");
        const claimed = await prisma.activityLog.updateMany({ where: { id: row.id, metadata: { equals: row.metadata! } }, data: { metadata: { ...settings, testRequestedAt: null, testDraftId: null, testSubmissionId: null } } });
        if (!claimed.count) throw new Error("Test already claimed.");
      }
      await workerHeartbeat(prisma, orgId, "processing", settings.mode);
      try {
        if (settings.mode === "hybrid" && !process.env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY on the worker before using Hybrid.");
        await runLocalIntake({ prisma, supabaseAdmin, orgId, folder, audioAction: AUDIO_RECEIVED, includeTest: args.includes("--include-test") || testOnce, mode: settings.mode === "manual" ? "local" : settings.mode, testOnce, reviewOnly: settings.mode === "manual" || !!settings.testDraftId, reviewDraftId: settings.testDraftId || undefined, testSubmissionId: settings.testSubmissionId || undefined });
        await workerHeartbeat(prisma, orgId, "idle", settings.mode);
      } catch (error) { await workerHeartbeat(prisma, orgId, "error", settings.mode); throw error; }
    } else if (command === "scan") {
      const rows = await prisma.activityLog.findMany({ where: { orgId, action: PHOTO_RECEIVED, createdAt: { gte: new Date(now.getTime() - 29 * 86400000) } }, orderBy: { createdAt: "desc" }, take: 2000 });
      const seen = new Set<string>();
      for (const row of rows) {
        const parsed = receiptSchema.safeParse(row.metadata);
        if (!parsed.success) continue;
        const receipt = parsed.data;
        if (args.includes("--submission") && receipt.submissionId !== args[args.indexOf("--submission") + 1]) continue;
        const id = deliveryId(orgId, receipt.inviteId, receipt.submissionId);
        if (seen.has(id)) continue;
        seen.add(id);
        if (!args.includes("--now") && row.createdAt.getTime() > now.getTime() - 15 * 60000 && !(args.includes("--include-test") && /^TEST\b/i.test(receipt.description.trim()))) continue;
        if (!args.includes("--include-test") && /^TEST\b/i.test(receipt.description.trim())) continue;
        if (await prisma.activityLog.findUnique({ where: { id }, select: { id: true } })) {
          const { generationJobId, completeMetadata } = await import("./local-generation-queue");
          const jobKey = generationJobId(orgId, receipt.inviteId, receipt.submissionId);
          const generation = await prisma.activityLog.findUnique({ where: { id: jobKey } });
          const current = generation?.metadata && typeof generation.metadata === "object" && !Array.isArray(generation.metadata) ? generation.metadata : null;
          const metadata = completeMetadata(generation?.metadata);
          if (generation && current && metadata) await prisma.activityLog.updateMany({ where: { id: jobKey, metadata: { equals: current } }, data: { metadata } });
          continue;
        }
        const { generationJobId, generationScanDecision } = await import("./local-generation-queue");
        const generation = await prisma.activityLog.findUnique({ where: { id: generationJobId(orgId, receipt.inviteId, receipt.submissionId) } });
        if (generationScanDecision(generation?.metadata, now) !== "run") continue;
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
        const { generationRecordSchema } = await import("../src/lib/marketing-evidence");
        const state = generationRecordSchema.safeParse(generation?.metadata);
        const input = { id, orgId, inviteId: receipt.inviteId, submissionId: receipt.submissionId, jobId: batch.invite.jobId, submittedAt: row.createdAt.toISOString(), location: receipt.location, description: receipt.description, transcript: batch.transcript, ownerNotes: state.success ? state.data.ownerNotes : "", postType: state.success ? state.data.postType : "project", photos };
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
      const { generationRecordSchema, checkedFieldsMatch } = await import("../src/lib/marketing-evidence");
      const { generationJobId } = await import("./local-generation-queue");
      const generation = await prisma.activityLog.findUnique({ where: { id: generationJobId(orgId, inviteId, submissionId) } });
      const state = generationRecordSchema.safeParse(generation?.metadata);
      if (["local-ollama", "openai"].includes(input.generator) && (!state.success || state.data.status !== "running" || !state.data.evidence || state.data.evidence.reasons.length || !state.data.issues || state.data.issues.length || !checkedFieldsMatch(draft, state.data.checkedFields))) throw new Error("Evidence and claim checks must pass on this exact copy before saving a generated pack.");
      if (["local-ollama", "openai"].includes(input.generator) && state.success) {
        const checked = state.data.evidence!;
        const receiptData = receiptSchema.parse(receipt.metadata);
        if (draft.assetIds.length !== batch.assets.length || checked.sources.voice !== batch.transcript || checked.sources.owner !== state.data.ownerNotes || checked.sources.notes !== [receiptData.location, receiptData.description].filter(Boolean).join("\n")) throw new Error("Submission evidence changed during generation. Run fresh checks.");
      }
      draft.sourceNotes = [...selected.map((asset) => asset.description || ""), batch.transcript, state.success ? state.data.ownerNotes : ""].filter(Boolean).join("\n\n").slice(0, 6000);
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
      let reviewed = false;
      if (["local-ollama", "openai"].includes(input.generator) && state.success && state.data.evidence) {
        const { loadContentReview } = await import("../src/lib/content-review-store");
        const { REVIEW_REQUEST } = await import("../src/lib/content-review");
        const current = await loadContentReview(orgId, draftId);
        const evidence = state.data.evidence;
        if (current && !current.voicePending && current.audio.map((audio) => audio.transcript).join("\n\n") === evidence.sources.voice && current.originals.receiptNotes.includes(evidence.sources.notes)) {
          const review = { draftId, inputHash: current.inputHash, status: "completed", policyVersion: 2, requestedAt: new Date().toISOString(), completedAt: new Date().toISOString(), engine: input.generator, imagesChecked: evidence.photos.length, evidence, result: { summary: "All selected photos and public fields passed evidence checks in a separate review pass. Owner approval is still required.", findings: [] } };
          await prisma.activityLog.upsert({ where: { id: current.reviewId }, create: { id: current.reviewId, orgId, jobId: batch.invite.jobId, action: REVIEW_REQUEST, metadata: review }, update: { metadata: review } });
          reviewed = true;
        }
      }
      console.log(JSON.stringify({ saved: true, reviewed, id, draftId, deliverAt, url: `${base.origin}/send-photos/${uploadInviteToken(inviteId)}/packs/${id}` }));
    } else if (command === "due" || command === "claim-email" || command === "record-email") {
      const sending = ownerSendDecision(process.env.INTAKE_EMAIL_SENDING === "enabled");
      if (command !== "record-email" && sending.email !== "chosen") { console.log(JSON.stringify({ due: [], claimed: false, email: "off until you choose to send", sms: "off", to: sending.to, phone: OWNER_NOTIFY_PHONE })); return; }
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
      console.log(JSON.stringify(command === "claim-email" ? { claimed: false } : { due, sms: "off", phone: OWNER_NOTIFY_PHONE }));
    } else throw new Error("Commands: scan [--include-test], save <file>, due, claim-email <pack-id>, record-email <claim-id> <provider-message-id>");
  } finally { await prisma.$disconnect(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Worker failed"); process.exitCode = 1; });
