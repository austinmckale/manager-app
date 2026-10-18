// Which local Ollama model does which job. Photo and note reads are many short calls, so they use
// the fast reader. Writing, fixing and fact-checking are a few calls where quality matters, so they
// can use a larger writer (INTAKE_OLLAMA_WRITER_MODEL, e.g. qwen3.5:9b).
export type LocalModels = { reader: string; writer: string };

export function localModels(env: NodeJS.ProcessEnv = process.env): LocalModels {
  const reader = env.INTAKE_OLLAMA_MODEL || "qwen3.5:4b";
  return { reader, writer: env.INTAKE_OLLAMA_WRITER_MODEL || reader };
}

/** Falls back to the reader when the writer was never downloaded, instead of failing every job. */
export async function installedLocalModels(env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch): Promise<LocalModels> {
  const models = localModels(env);
  if (models.writer === models.reader) return models;
  try {
    const response = await fetcher("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(5000) });
    const tags = (await response.json()) as { models?: { name?: string; model?: string }[] };
    const names = new Set((tags.models || []).flatMap((model) => [model.name, model.model]).filter(Boolean));
    return names.has(models.writer) ? models : { ...models, writer: models.reader };
  } catch {
    return { ...models, writer: models.reader };
  }
}
