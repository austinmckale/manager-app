import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const stateDir = join(root, '.vercel', 'marketing-worker-service');
const lockPath = join(stateDir, 'service.lock');
const statusPath = join(stateDir, 'status.json');
const once = process.argv.includes('--once');
let stopping = false;
let child;
let failures = 0;
let lastSuccessAt = null;
let lastResult = null;
let startedAt;

async function status(state, issue = null) {
  const record = { version: 1, pid: process.pid, startedAt, updatedAt: new Date().toISOString(), state, failures, lastSuccessAt, lastResult, issue };
  const temporary = `${statusPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2));
  await rename(temporary, statusPath);
}

// Never persist raw worker output: it may contain source notes or private links.
function summary(output) {
  const value = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  if (value.busy === true) return { busy: true };
  if (typeof value.generated !== 'boolean' || !Number.isInteger(value.transcribed) || value.transcribed < 0) throw new Error('invalid-result');
  return { transcribed: value.transcribed, generated: value.generated };
}

function run() {
  return new Promise((accept) => {
    let output = '';
    let failed = false;
    child = spawn(process.execPath, ['--import', 'tsx', join(root, 'scripts', 'intake-marketing-worker.ts'), 'run-local'], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, INTAKE_EMAIL_SENDING: 'disabled', OLLAMA_NO_CLOUD: '1' },
    });
    const timeout = setTimeout(() => { failed = true; child?.kill(); }, 60 * 60 * 1000);
    child.stdout.on('data', (data) => { output = (output + data.toString()).slice(-65536); });
    child.stderr.resume();
    child.on('error', () => { failed = true; });
    child.on('close', (code) => { clearTimeout(timeout); child = undefined; accept({ code: failed ? -1 : code, output }); });
  });
}

async function ollamaReady() {
  try {
    const response = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return false;
    const data = await response.json();
    return data.models?.some((model) => model.name === 'qwen3.5:4b') === true;
  } catch { return false; }
}

async function main() {
  await mkdir(stateDir, { recursive: true });
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('invalid-lock');
    try { process.kill(pid, 0); return; }
    catch (signalError) { if (signalError.code !== 'ESRCH') throw signalError; }
    await unlink(lockPath);
    lock = await open(lockPath, 'wx');
  }
  await lock.writeFile(String(process.pid));
  startedAt = new Date().toISOString();
  try {
    // Preserve the last successful check across restarts, without retaining media.
    try {
      const old = JSON.parse(await readFile(statusPath, 'utf8'));
      lastSuccessAt = typeof old.lastSuccessAt === 'string' ? old.lastSuccessAt : null;
    } catch { /* First start. */ }
    do {
      let issue = null;
      if (!await ollamaReady()) {
        issue = 'Start local Ollama with the downloaded qwen3.5:4b model.';
      } else {
        await status('processing');
        const result = await run();
        if (result.code !== 0) issue = 'Processing failed. Check internet access, database credentials and the local Python runtime; run the worker manually for diagnostics.';
        else {
          try { lastResult = summary(result.output); }
          catch { issue = 'Worker returned an unexpected result; run it manually for diagnostics.'; }
        }
      }
      if (stopping) break;
      if (issue) { failures += 1; await status('retrying', issue); }
      else { failures = 0; lastSuccessAt = new Date().toISOString(); await status('idle'); }
      if (once) { if (issue) process.exitCode = 1; break; }
      const delay = issue ? Math.min(15 * 60_000, 60_000 * 2 ** Math.min(failures - 1, 4)) : 60_000;
      const until = Date.now() + delay;
      while (!stopping && Date.now() < until) await new Promise((done) => setTimeout(done, 1000));
    } while (!stopping);
  } finally {
    if (stopping) await status('stopped');
    await lock.close();
    await unlink(lockPath).catch(() => undefined);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; child?.kill(); });
main().catch(() => { console.error('Marketing worker could not start. Check its folder, local status file and prerequisites.'); process.exitCode = 1; });
