// Only allowlisted counters and fixed messages may reach the status file.
export function workerSummary(output) {
  const value = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  if (value.busy === true) return { busy: true };
  if (typeof value.generated !== 'boolean' || !Number.isInteger(value.transcribed) || value.transcribed < 0) throw new Error('invalid-result');
  return { transcribed: value.transcribed, transcriptionFailed: Number.isInteger(value.transcriptionFailed) && value.transcriptionFailed > 0 ? value.transcriptionFailed : 0, generated: value.generated, generationFailed: Number.isInteger(value.generationFailed) && value.generationFailed > 0 ? value.generationFailed : 0, reviewed: value.reviewed === true, reviewFailed: value.reviewFailed === true };
}

export function workerFailure(stderr) {
  if (/TimeoutError|HeadersTimeoutError|aborted due to timeout|timed out/i.test(stderr)) return 'Processing timed out. Check local AI availability and PC load; queued work will retry.';
  if (/Local transcription unavailable/i.test(stderr)) return 'Local transcription failed. Check the Python runtime and recording; queued work will retry.';
  if (/private storage|source photo/i.test(stderr)) return 'Private media could not be downloaded. Check storage and internet access; queued work will retry.';
  if (/P1000|P1001|P1002|P1017|P2024/.test(stderr)) return 'Database connection failed. Check internet access and database configuration; queued work will retry.';
  if (/Cannot find module|ERR_MODULE_NOT_FOUND|does not provide an export named/i.test(stderr)) return 'Worker files are incomplete or mismatched. Redeploy the worker from master and run scripts/worker-preflight.ts; queued work will retry.';
  return 'Processing failed. Run the worker manually for diagnostics; queued work will retry.';
}

export function workerCheckState({ issue, lastResult, failures, lastSuccessAt }, now = new Date().toISOString()) {
  if (issue) return { state: 'retrying', issue, failures: failures + 1, lastSuccessAt };
  if (lastResult?.busy) return { state: 'waiting', issue: 'Another local worker is processing. This check was skipped.', failures, lastSuccessAt };
  if (lastResult?.transcriptionFailed || lastResult?.reviewFailed || lastResult?.generationFailed) return { state: 'attention', issue: 'Some local checks need attention. Open the processing queue and saved drafts.', failures: 0, lastSuccessAt: now };
  return { state: 'idle', issue: null, failures: 0, lastSuccessAt: now };
}
