import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const orgId = 'org';
const inviteId = '10000000-0000-4000-8000-000000000001';
const submissionId = '20000000-0000-4000-8000-000000000002';
const nextSubmissionId = '30000000-0000-4000-8000-000000000003';
const leaked = 'transcript: the gate code is 1234 https://storage.example/private/photo.jpg?token=secret';

function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (id === 'node:crypto') return require('node:crypto'); if (id === 'zod') return require('zod'); throw new Error(`Unexpected import ${id}`); }, Date, URL });
  return exports;
}

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    activityLog: {
      upsert: async (query) => { if (!rows.has(query.where.id)) rows.set(query.where.id, structuredClone(query.create)); },
      findUnique: async (query) => rows.get(query.where.id) || null,
      findMany: async (query) => [...rows.values()].filter((row) => row.orgId === query.where.orgId && row.action === query.where.action && row.metadata?.status === query.where.metadata.equals),
      updateMany: async (query) => {
        const row = rows.get(query.where.id);
        if (!row || JSON.stringify(row.metadata) !== JSON.stringify(query.where.metadata.equals)) return { count: 0 };
        row.metadata = structuredClone(query.data.metadata);
        return { count: 1 };
      },
    },
  };
}

const queue = load('scripts/local-generation-queue.ts');

test('restarting during generation keeps the same submission and job', async () => {
  const store = memoryStore();
  const now = new Date('2026-10-17T18:00:00.000Z');
  assert.equal(await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId, now), 'run');
  const id = queue.generationJobId(orgId, inviteId, submissionId);
  assert.equal(store.rows.get(id).metadata.status, 'running');
  assert.equal(store.rows.get(id).metadata.attempts, 1);
  assert.equal(store.rows.get(id).metadata.submissionId, submissionId);
  assert.equal(await queue.recoverInterruptedGeneration(store, orgId), 1);
  assert.equal(store.rows.get(id).metadata.status, 'queued');
  assert.equal(store.rows.get(id).metadata.attempts, 1);
  assert.equal(store.rows.get(id).metadata.submissionId, submissionId);
  assert.equal(await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId, now), 'run');
  assert.equal(store.rows.size, 1);
  assert.equal(store.rows.get(id).metadata.attempts, 2);
  assert.equal(store.rows.get(id).metadata.submissionId, submissionId);
});

test('a completed submission is not claimed or drafted again', async () => {
  const store = memoryStore();
  const now = new Date('2026-10-17T18:00:00.000Z');
  await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId, now);
  const completed = await queue.recordGenerationCompleted(store, orgId, inviteId, submissionId);
  assert.equal(completed.status, 'completed');
  assert.equal(queue.generationScanDecision(completed, now), 'skip');
  assert.equal(await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId, now), 'skip');
  assert.equal(store.rows.size, 1);
  assert.equal([...store.rows.values()][0].metadata.status, 'completed');
});

test('three temporary failures stop, and the next submission can still run', async () => {
  const store = memoryStore();
  let now = new Date('2026-10-17T18:00:00.000Z');
  const waits = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    assert.equal(await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId, now), 'run');
    const failed = await queue.recordGenerationFailure(store, orgId, inviteId, submissionId, now);
    assert.equal(failed.attempts, attempt);
    assert.equal(failed.error, queue.GENERATION_ERROR);
    assert.ok(!JSON.stringify(failed).includes('gate code'));
    if (attempt < 3) {
      assert.equal(failed.status, 'queued');
      waits.push(new Date(failed.nextRetryAt).getTime() - now.getTime());
      assert.equal(queue.generationScanDecision(failed, now), 'skip');
      now = new Date(failed.nextRetryAt);
    } else {
      assert.equal(failed.status, 'failed');
      assert.equal(failed.nextRetryAt, null);
    }
  }
  assert.deepEqual(waits, [5 * 60000, 10 * 60000]);
  assert.equal(await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId, now), 'skip');
  const jobs = new Map([[queue.generationJobId(orgId, inviteId, submissionId), store.rows.get(queue.generationJobId(orgId, inviteId, submissionId)).metadata]]);
  const next = queue.nextGenerationSubmission(orgId, [
    { inviteId, submissionId },
    { inviteId, submissionId: nextSubmissionId },
  ], jobs, now);
  assert.equal(next.submissionId, nextSubmissionId);
});

test('generation errors and status lines exclude secrets, transcripts and media URLs', () => {
  const message = queue.safeGenerationError(new Error(leaked));
  const line = JSON.stringify({ generationFailed: true, attempts: 1, error: message });
  assert.equal(message, queue.GENERATION_ERROR);
  assert.ok(!line.includes('transcript'));
  assert.ok(!line.includes('https://'));
  assert.ok(!line.includes('secret'));
  assert.ok(!line.includes('gate code'));
});
