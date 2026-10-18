// Run in a worker release folder before pointing the scheduled task at it:
//   node --import tsx scripts/worker-preflight.ts
// It only reads: every module the worker loads, the Ollama model list and one SELECT 1.
// A release with a missing file fails here instead of failing every cycle in the background.
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

const WORKER_MODULES = [
  "../src/lib/prisma", "../src/lib/supabase/admin", "../src/lib/field-intake", "../src/lib/intake-delivery",
  "../src/lib/marketing", "../src/lib/intake-audio", "../src/lib/owner-notify", "../src/lib/marketing-alerts",
  "../src/lib/marketing-processing", "../src/lib/raw-input", "../src/lib/publishability", "../src/lib/local-models",
  "./local-intake-runner", "./local-generation-queue", "./local-caption-revision", "./local-content-review",
  "./local-photo-analysis", "./local-evidence-pipeline", "./local-write-loop", "./local-voice-queue", "./marketing-ai-request",
];

async function main() {
  const problems: string[] = [];
  const envFile = process.env.INTAKE_WORKER_ENV_FILE || ".env.intake-production-verified";
  if (existsSync(".env.marketing-ai.local")) loadEnvFile(".env.marketing-ai.local");
  if (existsSync(envFile)) loadEnvFile(envFile);
  else problems.push(`Missing ${envFile}.`);

  for (const path of WORKER_MODULES) {
    try { await import(path); }
    catch (error) { problems.push(`${path}: ${String(error instanceof Error ? error.message : error).split("\n")[0].slice(0, 200)}`); }
  }

  const { localModels } = await import("../src/lib/local-models");
  const { reader, writer } = localModels();
  const notes: string[] = [];
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) });
    const tags = (await response.json()) as { models?: { name?: string }[] };
    const installed = new Set((tags.models || []).map((model) => model.name));
    if (!installed.has(reader)) problems.push(`Ollama does not have the reader model ${reader}.`);
    if (writer !== reader && !installed.has(writer)) notes.push(`Writer model ${writer} is not downloaded; ${reader} will write.`);
  } catch {
    notes.push("Ollama is not running; the worker starts it on its next cycle.");
  }

  if (problems.length === 0) {
    try {
      const { prisma } = await import("../src/lib/prisma");
      await prisma.$queryRaw`SELECT 1`;
      await prisma.$disconnect();
    } catch {
      problems.push("Database connection failed.");
    }
  }

  console.log(JSON.stringify({ ok: problems.length === 0, reader, writer, problems, notes }, null, 2));
  process.exit(problems.length ? 1 : 0);
}

main();
