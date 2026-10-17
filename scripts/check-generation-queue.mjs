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

const loaded = new Map();
function load(file) {
  const normalized = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (loaded.has(normalized)) return loaded.get(normalized);
  const exports = {};
  loaded.set(normalized, exports);
  const code = ts.transpileModule(readFileSync(new URL(`../${normalized}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const dir = normalized.split('/').slice(0, -1).join('/');
  vm.runInNewContext(code, { exports, require(id) { if (id === 'node:crypto') return require('node:crypto'); if (id === 'zod') return require('zod'); if (!id.startsWith('.')) throw new Error(`Unexpected import ${id}`); const parts = []; for (const part of `${dir}/${id}`.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); } const next = parts.join('/'); return load(next.endsWith('.ts') ? next : `${next}.ts`); }, Date, URL });
  return exports;
}

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    activityLog: {
      upsert: async (query) => { if (!rows.has(query.where.id)) rows.set(query.where.id, structuredClone(query.create)); },
      create: async (query) => { if (rows.has(query.data.id)) { const error = new Error('Unique constraint'); error.code = 'P2002'; throw error; } rows.set(query.data.id, structuredClone(query.data)); return rows.get(query.data.id); },
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
const request = load('src/lib/marketing-generation-request.ts');
const assetId = '40000000-0000-4000-8000-000000000004';
const otherAssetId = '50000000-0000-4000-8000-000000000005';
const foreignAssetId = '60000000-0000-4000-8000-000000000006';
const evidence = { version: 1, sources: { notes: 'Reading', voice: '', owner: '' }, postType: 'project', photos: [{ assetId, relevance: 'construction', observations: ['A patio.'], concerns: [] }], notes: { facts: [], conflicts: [] }, reasons: [] };
function receipt(fileAssetId, owner = orgId) {
  return { orgId: owner, jobId: 'job', action: 'field.photo.received', metadata: { inviteId, submissionId, fileAssetId } };
}
function asset(id, owner = orgId, target = submissionId) {
  return { id, tags: [`intake:${inviteId}`, `submission:${target}`, 'capture:crew'], job: { orgId: owner } };
}
function settingsRow() {
  return { id: 'settings', orgId, action: 'marketing.processing.settings', metadata: { enabled: false, mode: 'hybrid', dailyCallLimit: 60, testRequestedAt: null, testDraftId: null, testSubmissionId: null } };
}

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

test('an owner request queues one local job and a repeat does not reset attempts', async () => {
  const store = memoryStore();
  store.rows.set('settings', settingsRow());
  const before = JSON.stringify(store.rows.get('settings'));
  const invite = request.ownerInviteFromReceipts(orgId, submissionId, [receipt(assetId)]);
  const assetIds = request.ownerAssetIds(orgId, invite.inviteId, submissionId, invite.fileAssetIds, [asset(assetId)]);
  const queued = await queue.queueOwnerGenerationJob(store, orgId, invite.jobId, invite.inviteId, submissionId, assetIds, 'owner');
  const id = queued.id;
  assert.equal(queued.deduped, false);
  assert.equal(queued.approved, false);
  assert.equal(queued.job.status, 'queued');
  assert.equal(queued.job.attempts, 0);
  assert.equal(queued.job.engine, 'local');
  assert.equal(queued.job.source, 'owner');
  assert.equal(queued.job.submissionId, submissionId);
  assert.deepEqual(queued.job.assetIds, [assetId]);
  assert.equal(queued.job.sourceHash, queue.generationSourceHash([assetId]));
  assert.equal(JSON.stringify(queued.job).includes('ownerApproved":true'), false);
  store.rows.get(id).metadata.attempts = 2;
  const repeat = await queue.queueOwnerGenerationJob(store, orgId, invite.jobId, invite.inviteId, submissionId, [otherAssetId], 'owner');
  assert.equal(repeat.deduped, true);
  assert.equal(repeat.approved, false);
  assert.equal(repeat.job.attempts, 2);
  assert.equal(store.rows.get(id).metadata.attempts, 2);
  assert.deepEqual(store.rows.get(id).metadata.assetIds, [assetId]);
  assert.equal(store.rows.get(id).metadata.status, 'queued');
  assert.equal(await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId), 'run');
  assert.equal(store.rows.get(id).metadata.engine, 'local');
  assert.equal(store.rows.get(id).metadata.source, 'owner');
  assert.equal(store.rows.get(id).metadata.attempts, 3);
  const running = await queue.queueOwnerGenerationJob(store, orgId, invite.jobId, invite.inviteId, submissionId, assetIds, 'owner');
  assert.equal(running.deduped, true);
  assert.equal(running.job.status, 'running');
  assert.equal(store.rows.get(id).metadata.attempts, 3);
  assert.equal(JSON.stringify(store.rows.get('settings')), before);
  assert.equal(store.rows.get('settings').metadata.enabled, false);
  assert.equal(store.rows.get('settings').metadata.testRequestedAt, null);
});

test('two owner submissions stay queued without turning automatic processing on', async () => {
  const store = memoryStore();
  store.rows.set('settings', settingsRow());
  const first = await queue.queueOwnerGenerationJob(store, orgId, 'job', inviteId, submissionId, [assetId]);
  const second = await queue.queueOwnerGenerationJob(store, orgId, 'job', inviteId, nextSubmissionId, [otherAssetId]);
  assert.notEqual(first.id, second.id);
  assert.equal(store.rows.get(first.id).metadata.status, 'queued');
  assert.equal(store.rows.get(second.id).metadata.status, 'queued');
  assert.equal(store.rows.get(first.id).metadata.engine, 'local');
  assert.equal(store.rows.get(second.id).metadata.source, 'owner');
  const listed = await queue.listRunnableOwnerLocalJobs(store, orgId, new Date('2026-10-17T18:00:00.000Z'));
  assert.deepEqual(listed.map((job) => job.submissionId).sort(), [submissionId, nextSubmissionId].sort());
  const settings = { enabled: false, mode: 'manual', testRequestedAt: null, testDraftId: null, testSubmissionId: null };
  const before = structuredClone(settings);
  const plan = queue.ownerLocalRunPlan(settings, listed);
  assert.deepEqual(settings, before);
  assert.equal(plan.automaticPaused, true);
  assert.equal(plan.ownerEngine, 'local');
  assert.equal(plan.callsOpenAI, false);
  assert.equal(plan.changesAutomaticSettings, false);
  assert.equal(plan.deferOwnerJobsBeforeHybrid, false);
  assert.equal(store.rows.get('settings').metadata.enabled, false);
  assert.equal(store.rows.get('settings').metadata.testRequestedAt, null);
  const hybrid = queue.ownerLocalRunPlan({ enabled: true, mode: 'hybrid', testRequestedAt: null }, listed);
  assert.equal(hybrid.callsOpenAI, false);
  assert.equal(hybrid.ownerEngine, 'local');
  assert.equal(hybrid.deferOwnerJobsBeforeHybrid, true);
  assert.equal(queue.ownerSourceStillMatches(first.job.sourceHash, [assetId]), true);
  assert.equal(queue.ownerSourceStillMatches(first.job.sourceHash, [otherAssetId]), false);
  assert.equal((await queue.holdChangedOwnerSource(store, orgId, inviteId, submissionId))?.status, 'held');
  assert.equal(store.rows.get(first.id).metadata.engine, 'local');
  assert.equal(queue.generationScanDecision(store.rows.get(first.id).metadata, new Date('2026-10-17T18:00:00.000Z')), 'skip');
});

test('another organization and photos outside the submission are rejected', () => {
  assert.equal(request.ownerGenerationBodySchema.safeParse({ submissionId }).success, true);
  assert.equal(request.ownerGenerationBodySchema.safeParse({ submissionId, assetIds: [foreignAssetId] }).success, false);
  assert.throws(() => request.ownerInviteFromReceipts(orgId, submissionId, [receipt(assetId, 'other-org')]), (error) => error.status === 404);
  assert.throws(() => request.ownerInviteFromReceipts(orgId, submissionId, []), (error) => error.status === 404);
  const invite = request.ownerInviteFromReceipts(orgId, submissionId, [receipt(foreignAssetId)]);
  assert.throws(() => request.ownerAssetIds(orgId, invite.inviteId, submissionId, invite.fileAssetIds, [asset(assetId)]), (error) => error.status === 409);
  assert.throws(() => request.ownerAssetIds(orgId, inviteId, submissionId, [assetId], [asset(assetId, 'other-org')]), (error) => error.status === 409);
  assert.deepEqual(request.ownerAssetIds(orgId, inviteId, submissionId, [assetId], [asset(assetId), asset(otherAssetId, orgId, nextSubmissionId)]), [assetId]);
});

test('a missing worker leaves the owner job queued and unapproved', async () => {
  const store = memoryStore();
  const queued = await queue.queueOwnerGenerationJob(store, orgId, 'job', inviteId, submissionId, [assetId]);
  assert.equal(queued.job.status, 'queued');
  assert.equal(queued.approved, false);
  assert.equal(store.rows.get(queued.id).metadata.status, 'queued');
  assert.equal(store.rows.get(queued.id).metadata.attempts, 0);
  assert.equal(store.rows.size, 1);
});

test('stale evidence and a stale defer do not overwrite a newer job', async () => {
  const store = memoryStore();
  const now = new Date('2026-10-17T18:00:00.000Z');
  await queue.queueOwnerGenerationJob(store, orgId, 'job', inviteId, submissionId, [assetId]);
  assert.equal(await queue.claimGenerationJob(store, orgId, 'job', inviteId, submissionId, now), 'run');
  const id = queue.generationJobId(orgId, inviteId, submissionId);
  const original = store.activityLog.updateMany;
  let raced = false;
  store.activityLog.updateMany = async (query) => {
    if (!raced) {
      raced = true;
      store.rows.get(query.where.id).metadata = { ...structuredClone(store.rows.get(query.where.id).metadata), attempts: 9, engine: 'local', source: 'owner' };
    }
    return original(query);
  };
  await assert.rejects(() => queue.recordEvidenceResult(store, orgId, inviteId, submissionId, evidence, [], false), /changed/);
  assert.equal(store.rows.get(id).metadata.attempts, 9);
  assert.equal(store.rows.get(id).metadata.engine, 'local');
  assert.equal(store.rows.get(id).metadata.evidence, undefined);
  store.activityLog.updateMany = original;
  store.rows.get(id).metadata = { ...store.rows.get(id).metadata, status: 'queued', attempts: 4, nextRetryAt: null, runningAt: null };
  let deferred = false;
  store.activityLog.updateMany = async (query) => {
    if (!deferred) {
      deferred = true;
      store.rows.get(query.where.id).metadata = { ...structuredClone(store.rows.get(query.where.id).metadata), attempts: 7 };
    }
    return original(query);
  };
  assert.equal(await queue.deferQueuedOwnerJobs(store, orgId, now), 0);
  assert.equal(store.rows.get(id).metadata.attempts, 7);
  assert.equal(store.rows.get(id).metadata.nextRetryAt, null);
  store.activityLog.updateMany = original;
  store.rows.get(id).metadata = { ...store.rows.get(id).metadata, status: 'queued', attempts: 1, nextRetryAt: null };
  assert.equal(await queue.deferQueuedOwnerJobs(store, orgId, now), 1);
  assert.equal(queue.generationScanDecision(store.rows.get(id).metadata, now), 'skip');
  assert.equal(store.rows.get(id).metadata.attempts, 1);
  assert.equal(store.rows.get(id).metadata.engine, 'local');
  assert.equal(store.rows.get(id).metadata.source, 'owner');
});

test('the owner worker path stays on local Ollama while automatic processing is off', () => {
  const worker = readFileSync(new URL('./intake-marketing-worker.ts', import.meta.url), 'utf8');
  const ownerPath = worker.slice(worker.indexOf('const plan = ownerLocalRunPlan'), worker.indexOf('const testOnce = plan.testOnce'));
  assert.match(ownerPath, /mode:\s*plan\.ownerEngine/);
  assert.match(ownerPath, /plan\.automaticPaused/);
  assert.equal(ownerPath.includes('OPENAI'), false);
  assert.equal(ownerPath.includes('testRequestedAt'), false);
  assert.equal(ownerPath.includes('api.openai.com'), false);
  const library = readFileSync(new URL('../src/lib/marketing-generation-request.ts', import.meta.url), 'utf8');
  assert.equal(library.includes('testRequestedAt'), false);
  assert.equal(library.includes('openai'), false);
  const route = readFileSync(new URL('../src/app/api/marketing/generate/route.ts', import.meta.url), 'utf8');
  assert.equal(route.includes('testRequestedAt'), false);
  assert.equal(route.includes('openai'), false);
  assert.equal(route.includes('enabled: true'), false);
});
