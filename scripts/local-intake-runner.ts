import { readFile, writeFile, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import type { PrismaClient } from "@prisma/client";
import type { supabaseAdmin as SupabaseAdmin } from "../src/lib/supabase/admin";
import { z } from "zod";
import { marketingDraftSchema } from "../src/lib/marketing";
import { localAiSettings } from "./local-ai-settings";
import { processVoiceQueue } from "./local-voice-queue";
import { inspectSubmission } from "./local-evidence-pipeline";
import { publicFields } from "../src/lib/marketing-evidence";
import { marketingAiRequest } from "./marketing-ai-request";
import { installedLocalModels } from "../src/lib/local-models";
import { WRITER_SYSTEM, completeCopy, publicCopy, writeCheckedCopy, writeLoopPlan } from "./local-write-loop";
import { voiceContext } from "./local-voice";

const workerFile = resolve("scripts/intake-marketing-worker.ts");
function runWorker(args: string[]) {
  const result = spawnSync(process.execPath, ["--import", "tsx", workerFile, ...args], { encoding: "utf8", timeout: 180000, windowsHide: true });
  if (result.status !== 0) throw new Error(`Worker step failed: ${String(result.stderr || result.error?.message || "unknown error").slice(-500)}`);
  return JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!);
}

export async function runLocalIntake({ prisma, supabaseAdmin, orgId, folder, audioAction, includeTest, mode = "local", testOnce = false, reviewOnly = false, reviewDraftId, testSubmissionId }: { prisma: PrismaClient; supabaseAdmin: typeof SupabaseAdmin; orgId: string; folder: string; audioAction: string; includeTest: boolean; mode?: "hybrid" | "local"; testOnce?: boolean; reviewOnly?: boolean; reviewDraftId?: string; testSubmissionId?: string }) {
  const lockPath = join(folder, "local-worker.lock");
  let lock;
  try { lock = await open(lockPath, "wx"); }
  catch (error) {
    if (!(typeof error === "object" && error && "code" in error && error.code === "EEXIST")) throw error;
    const pid = Number(await readFile(lockPath, "utf8"));
    let running = true;
    try { process.kill(pid, 0); } catch { running = false; }
    if (running) { console.log(JSON.stringify({ busy: true })); return; }
    await unlink(lockPath); lock = await open(lockPath, "wx");
  }
  await lock.writeFile(String(process.pid));
  try {
    const aiRequest = marketingAiRequest(prisma, orgId, mode, testOnce);
    const configuredModel = mode === "hybrid" ? process.env.MARKETING_OPENAI_MODEL || "gpt-4.1-mini" : process.env.INTAKE_OLLAMA_MODEL || "qwen3.5:4b";
    const models = mode === "hybrid" ? { reader: configuredModel, writer: configuredModel } : await installedLocalModels();
    const { runContentReview } = await import("./local-content-review");
    const { resolveUploadInvite, uploadInviteToken } = await import("../src/lib/field-intake");
    const audio = await prisma.activityLog.findMany({ where: { orgId, action: audioAction, metadata: { path: ["status"], equals: "queued" } }, orderBy: { createdAt: "asc" }, take: 20 });
    const { transcribed, transcriptionFailed } = await processVoiceQueue(audio, async (row) => {
      const meta = row.metadata as { inviteId: string; submissionId: string; storageKey: string; mimeType: string; [key: string]: unknown };
      const invite = await resolveUploadInvite(uploadInviteToken(meta.inviteId));
      if (!invite || invite.orgId !== orgId || !meta.storageKey.startsWith(`${orgId}/${invite.jobId}/intake/${invite.id}/voice-`)) return null;
      const { data, error } = await supabaseAdmin.storage.from(process.env.SUPABASE_STORAGE_BUCKET ?? "job-assets").download(meta.storageKey);
      if (error || !data) throw new Error("Voice recording unavailable in private storage.");
      const path = join(folder, `voice-${row.id}.${meta.mimeType === "audio/mp4" ? "m4a" : "webm"}`);
      await writeFile(path, Buffer.from(await data.arrayBuffer()));
      const python = process.env.INTAKE_PYTHON || "C:/Users/Alivia/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe";
      const packages = resolve(".vercel/local-ai/python-packages");
      const result = spawnSync(python, [resolve("scripts/local-transcribe.py"), path], { encoding: "utf8", timeout: 600000, windowsHide: true, env: { ...process.env, INTAKE_PYTHON_PACKAGES: packages, HF_HUB_DISABLE_TELEMETRY: "1" } });
      if (result.status !== 0) throw new Error(`Local transcription unavailable: ${String(result.stderr || result.error?.message || "unknown error").slice(-500)}`);
      const spoken = z.object({ text: z.string().min(1) }).parse(JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)!)).text;
      const { keepRawText } = await import("../src/lib/raw-input");
      const transcript = keepRawText(spoken).text;
      if (!transcript) throw new Error("empty-transcript");
      return transcript;
    }, async (row, metadata) => { await prisma.activityLog.update({ where: { id: row.id }, data: { metadata: JSON.parse(JSON.stringify(metadata)) } }); });
    const { recoverInterruptedGeneration, claimGenerationJob, recordGenerationFailure, recordGenerationCompleted, recordEvidenceResult, safeGenerationError } = await import("./local-generation-queue");
    await recoverInterruptedGeneration(prisma, orgId);
    let generated = false;
    let generatedReviewed = false;
    let generationFailed = 0;
    let held = 0;
    let engine = configuredModel;
    for (let pass = 0; pass < (reviewOnly ? 0 : testOnce ? 1 : 8) && !generated; pass++) {
      const scan = runWorker(["scan", ...(includeTest ? ["--include-test"] : []), ...(testOnce ? ["--now"] : []), ...(testSubmissionId ? ["--submission", testSubmissionId] : [])]);
      if (!scan.pending) break;
      const source = scan.input as { inviteId: string; submissionId: string; location: string; description: string; transcript?: string; ownerNotes?: string; postType?: "project" | "company_life"; photos: { id: string; path: string }[] };
      if (await claimGenerationJob(prisma, orgId, null, source.inviteId, source.submissionId) !== "run") continue;
      try {
        const sharp = (await import("sharp")).default;
        const settings = localAiSettings();
        const images = await Promise.all(source.photos.map(async (photo) => ({ id: photo.id, image: (await sharp(await readFile(photo.path)).resize({ width: settings.imageSize, height: settings.imageSize, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()).toString("base64") })));
        if (mode === "local" && [models.reader, models.writer].some((model) => model.includes("cloud") || model.includes("/"))) throw new Error("A downloaded local Ollama model is required; cloud models are disabled.");
        const evidence = await inspectSubmission({ model: models.reader, photos: images, postType: source.postType || "project", sources: { notes: [source.location, source.description].filter(Boolean).join("\n"), voice: source.transcript || "", owner: source.ownerNotes || "" } }, aiRequest);
        if (evidence.reasons.length) {
          await recordEvidenceResult(prisma, orgId, source.inviteId, source.submissionId, evidence, evidence.reasons, true);
          held++; continue;
        }
        await recordEvidenceResult(prisma, orgId, source.inviteId, source.submissionId, evidence, [], false);
        const { analyzeLocalPhotos } = await import("./local-photo-analysis");
        if (mode === "local") await analyzeLocalPhotos({ prisma, orgId, inviteId: source.inviteId, model: models.reader, photos: source.photos, notes: [source.description, source.transcript || ""].join("\n\n") });
        // Write, fact-check in a separate pass, and send the findings back to the writer before
        // holding anything. Missing, malformed or unsupported checks never count as a pass.
        const written = await writeCheckedCopy({
          request: aiRequest,
          model: models.writer,
          evidence,
          schema: publicCopy,
          plan: writeLoopPlan(mode),
          context: await voiceContext(prisma, orgId),
          options: { num_ctx: 8192, num_predict: 2200, ...settings.options },
          complete: completeCopy,
          system: WRITER_SYSTEM,
        });
        const copy = written.copy;
        console.log(JSON.stringify({ writeLoop: true, writes: written.writes, checks: written.checks, remainingIssues: written.issues.length }));
        if (written.issues.length) {
          await recordEvidenceResult(prisma, orgId, source.inviteId, source.submissionId, evidence, written.issues, true);
          held++; continue;
        }
        await recordEvidenceResult(prisma, orgId, source.inviteId, source.submissionId, evidence, [], false, publicFields(copy));
        const draft = marketingDraftSchema.parse({ ...copy, postType: evidence.postType, assetIds: source.photos.map((photo) => photo.id), sourceNotes: "", photoNotes: [], landingUrl: "https://rhipros.com/request-a-quote" });
        const output = { inviteId: source.inviteId, submissionId: source.submissionId, generator: mode === "hybrid" ? "openai" : "local-ollama", draft };
        await writeFile(scan.outputPath, JSON.stringify(output, null, 2));
        const saved = runWorker(["save", scan.outputPath]);
        generatedReviewed = saved.reviewed === true;
        await recordGenerationCompleted(prisma, orgId, source.inviteId, source.submissionId);
        generated = true;
        engine = models.reader === models.writer ? models.writer : `${models.reader} + ${models.writer}`;
      } catch {
        const failed = await recordGenerationFailure(prisma, orgId, source.inviteId, source.submissionId);
        generationFailed += 1;
        console.log(JSON.stringify({ generationFailed: true, attempts: failed?.attempts ?? 0, error: safeGenerationError() }));
      }
    }
    if (!generated) {
      const contentReview = await runContentReview(prisma, supabaseAdmin, orgId, includeTest, { model: models.reader, writer: models.writer, request: aiRequest, draftId: reviewDraftId });
      console.log(JSON.stringify({ transcribed, transcriptionFailed, generated: false, generationFailed, held, ...contentReview })); return;
    }
    console.log(JSON.stringify({ transcribed, transcriptionFailed, generated: true, generationFailed, held, reviewed: generatedReviewed, engine, inference: mode }));
  } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
}
