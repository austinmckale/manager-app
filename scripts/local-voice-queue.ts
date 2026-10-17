// Isolate recording failures so a broken file cannot stop later submissions.
export async function processVoiceQueue<T extends { metadata: unknown }>(
  rows: T[],
  transcribe: (row: T) => Promise<string | null>,
  persist: (row: T, metadata: Record<string, unknown>) => Promise<void>,
  now = new Date(),
) {
  let transcribed = 0;
  let transcriptionFailed = 0;
  for (const row of rows) {
    const meta = row.metadata as Record<string, unknown> | null;
    if (!meta || meta.status !== "queued") continue;
    if (typeof meta.nextRetryAt === "string" && new Date(meta.nextRetryAt).getTime() > now.getTime()) continue;
    const attempts = typeof meta.transcriptionAttempts === "number" && Number.isInteger(meta.transcriptionAttempts) && meta.transcriptionAttempts >= 0 ? meta.transcriptionAttempts : 0;
    let transcript: string | null;
    try {
      transcript = await transcribe(row);
      if (transcript === null) continue;
      if (!transcript.trim()) throw new Error("empty-transcript");
    } catch {
      const count = attempts + 1;
      await persist(row, { ...meta, status: count >= 3 ? "failed" : "queued", transcriptionAttempts: count, lastAttemptAt: now.toISOString(), nextRetryAt: count >= 3 ? null : new Date(now.getTime() + count * 5 * 60000).toISOString(), transcriptionError: "Local transcription could not complete. Check the recording and local Python runtime, then retry." });
      transcriptionFailed++;
      continue;
    }
    await persist(row, { ...meta, status: "transcribed", transcript, transcriptionAttempts: attempts + 1, transcribedAt: now.toISOString(), nextRetryAt: null, transcriptionError: null, engine: "faster-whisper-small.en-local-cpu" });
    transcribed++;
  }
  return { transcribed, transcriptionFailed };
}
