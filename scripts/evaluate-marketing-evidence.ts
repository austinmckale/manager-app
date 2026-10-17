import { readFile } from "node:fs/promises";
import { inspectSubmission } from "./local-evidence-pipeline";
import { localAiSettings } from "./local-ai-settings";

// Read-only local evaluation: no database writes, cloud calls or notifications.
async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Pass a private worker source.json file to evaluate.");
  const source = JSON.parse(await readFile(file, "utf8")) as { location: string; description: string; transcript?: string; ownerNotes?: string; photos: { id: string; path: string }[] };
  const sharp = (await import("sharp")).default;
  const model = process.env.INTAKE_OLLAMA_MODEL || "qwen3.5:4b";
  if (model.includes("cloud") || model.includes("/")) throw new Error("This evaluation uses downloaded local models only.");
  const size = localAiSettings().imageSize;
  const photos = await Promise.all(source.photos.map(async (photo) => ({ id: photo.id, image: (await sharp(await readFile(photo.path)).resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()).toString("base64") })));
  const evidence = await inspectSubmission({ model, photos, sources: { notes: [source.location, source.description].filter(Boolean).join("\n"), voice: source.transcript || "", owner: source.ownerNotes || "" }, postType: "project" });
  console.log(JSON.stringify({ localOnly: true, inspected: evidence.photos.length, relevance: evidence.photos.map((photo) => photo.relevance), usableNoteFacts: evidence.notes.facts.length, held: evidence.reasons.length > 0, issues: evidence.reasons.length }));
}
main().catch(() => { console.error("Local evidence evaluation failed. Check Ollama and the source file; nothing was saved or published."); process.exitCode = 1; });
