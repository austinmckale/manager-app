import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { createServer } from 'node:http';
const require = createRequire(import.meta.url);
function load(file, imports) {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected import ${name}`); }, Date, Set, Map, Buffer, URL, Response, setTimeout, clearTimeout, process: { env: {} } });
  return exports;
}
const marketing = load('src/lib/marketing.ts', { zod: require('zod') });
const evidence = load('src/lib/marketing-evidence.ts', { zod: require('zod') });
const processing = load('src/lib/marketing-processing.ts', { zod: require('zod'), 'node:crypto': require('node:crypto') });
const review = load('src/lib/content-review.ts', { zod: require('zod'), 'node:crypto': require('node:crypto'), '@/lib/marketing': marketing, '@/lib/marketing-evidence': evidence });
const draftId = '10000000-0000-4000-8000-000000000001';
const photoId = '20000000-0000-4000-8000-000000000001';
const nextId = '30000000-0000-4000-8000-000000000001';
const draft = marketing.prepareMarketingDraft({ assetIds: [photoId], notes: ['Built a pavilion in Reading.'] });
const hash = review.contentHash({ draft, originals: 'raw notes' });
const completed = { draftId, inputHash: hash, requestedAt: new Date().toISOString(), status: 'completed', policyVersion: 2, evidence: { version: 1, sources: { notes: '', voice: '', owner: '' }, postType: 'project', photos: [{ assetId: photoId, relevance: 'construction', observations: ['A pavilion.'], concerns: [] }], notes: { facts: [], conflicts: [] }, reasons: [] }, result: { summary: 'Checked against supplied evidence.', findings: [] } };
const blocker = { category: 'facts', severity: 'blocker', detail: 'Unsupported warranty.', evidence: 'Original notes contain no warranty.', suggestion: 'Remove it.' };
test('review identity changes with edited text, selected photos or original evidence', () => {
  const id = review.contentReviewId(draftId, hash);
  assert.equal(id, review.contentReviewId(draftId, hash));
  for (const changed of [{ draft: { ...draft, social: 'Edited' }, originals: 'raw notes' }, { draft: { ...draft, assetIds: [nextId] }, originals: 'raw notes' }, { draft, originals: 'corrected transcript' }]) assert.notEqual(review.contentReviewId(draftId, review.contentHash(changed)), id);
});
test('approval requires completed current review without blockers, pending speech or supersession', () => {
  assert.equal(review.canApproveContent(hash, completed, false, false), true);
  for (const candidate of [null, { ...completed, status: 'queued' }, { ...completed, status: 'failed' }, { ...completed, inputHash: 'x'.repeat(64) }, { ...completed, result: { ...completed.result, findings: [blocker] } }]) assert.equal(review.canApproveContent(hash, candidate, false, false), false);
  assert.equal(review.canApproveContent(hash, completed, true, false), false);
  assert.equal(review.canApproveContent(hash, completed, false, true), false);
});
test('code checks stop empty copy, external destinations, contact details and repeated headlines', () => {
  for (const change of [{ social: '' }, { landingUrl: 'https://example.com' }, { social: 'Contact customer@private.example' }, { googleHeadlines: ['Same', 'same', 'Same'] }]) assert.ok(review.copyChecks({ ...draft, ...change }).some((finding) => finding.severity === 'blocker'));
});
test('AI text blockers need an exact public quote and duplicate findings are removed', () => {
  const item = { ...blocker, publicField: 'social', quote: 'private source text' };
  const unknown = review.groundReviewFindings(draft, { summary: 'Check', findings: [item, item] });
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].severity, 'warning');
  const grounded = review.groundReviewFindings({ ...draft, social: 'Lifetime warranty included.' }, { summary: 'Check', findings: [{ ...item, quote: 'Lifetime warranty' }] });
  assert.equal(grounded[0].severity, 'blocker');
  assert.match(grounded[0].evidence, /social/);
});
test('visual observations require human resolution; privacy and factual blockers remain blocking', () => {
  const checked = review.reviewRecordSchema.parse({ ...completed, result: { summary: 'Image coverage needs confirmation.', findings: [{ ...blocker, category: 'images' }, { ...blocker, category: 'privacy' }, blocker] } });
  assert.equal(checked.result.findings[0].severity, 'warning');
  assert.equal(checked.result.findings[1].severity, 'blocker');
  assert.equal(checked.result.findings[2].severity, 'blocker');
  assert.equal(review.canApproveContent(hash, checked, false, false), false);
});
function harness(options = {}) {
  const writes = [];
  const context = { draftId, inputHash: hash, jobId: 'job', reviewId: nextId, draft, superseded: false, voicePending: false, review: completed, approvedAt: null, ...options.context };
  const tx = { activityLog: { findFirst: async () => null, create: async (query) => { writes.push(query); return { id: nextId }; }, upsert: async (query) => { writes.push(query); return {}; } } };
  const route = load('src/app/api/marketing/review/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, zod: require('zod'),
    '@/lib/auth': { requireAuth: async () => { if (options.unauthenticated) throw new Error('Unauthorized'); return { orgId: 'org', userId: 'owner', email: options.client ? 'rhisolutions316@gmail.com' : 'austinmck17@gmail.com' }; } },
    '@/lib/client-portal-policy': { isDashboardOwnerEmail: (email) => email === 'austinmck17@gmail.com' },
    '@/lib/demo': { isDemoMode: () => options.demo || false }, '@/lib/marketing': marketing, '@/lib/content-review': review, '@/lib/marketing-processing': processing,
    '@/lib/content-review-store': { loadContentReview: async (orgId) => { assert.equal(orgId, 'org'); return options.missing ? null : context; } },
    '@/lib/prisma': { prisma: { $transaction: async (fn) => fn(tx) } },
  });
  return { writes, request: (body) => route.POST(new Request('https://app.rhipros.com/api/marketing/review', { method: 'POST', headers: { 'content-type': 'application/json', origin: options.crossOrigin ? 'https://attacker.example' : 'https://app.rhipros.com' }, body: JSON.stringify({ draftId, inputHash: hash, ...body }) })) };
}
test('review mutations reject cross-origin, unauthenticated, client and preview requests', async () => {
  for (const [options, status] of [[{ crossOrigin: true }, 403], [{ unauthenticated: true }, 401], [{ client: true }, 403], [{ demo: true }, 409]]) {
    const h = harness(options); assert.equal((await h.request({ action: 'check' })).status, status); assert.equal(h.writes.length, 0);
  }
});
const approval = { action: 'approve', factsChecked: true, photosCleared: true, resolution: '' };
test('stale, missing, superseded, pending and blocked drafts never produce approvals', async () => {
  for (const options of [{ missing: true }, { context: { superseded: true } }, { context: { voicePending: true } }, { context: { review: null } }, { context: { inputHash: 'x'.repeat(64) } }, { context: { review: { ...completed, result: { ...completed.result, findings: [blocker] } } } }]) {
    const h = harness(options); assert.equal((await h.request(approval)).status, 409); assert.equal(h.writes.length, 0);
  }
});
test('owner confirmation and warning resolution are mandatory; exact approval is idempotent', async () => {
  assert.equal((await harness().request({ ...approval, factsChecked: false })).status, 400);
  const warning = { ...blocker, severity: 'warning' };
  const h = harness({ context: { review: { ...completed, result: { ...completed.result, findings: [warning] } } } });
  assert.equal((await h.request(approval)).status, 409);
  assert.equal((await h.request({ ...approval, resolution: 'Checked with Ryan; removed the uncertain wording.' })).status, 200);
  assert.equal(h.writes[0].data.action, review.REVIEW_APPROVAL);
  assert.equal(h.writes[0].data.metadata.inputHash, hash);
  const old = harness({ context: { approvedAt: new Date().toISOString() } });
  assert.equal((await old.request(approval)).status, 200); assert.equal(old.writes.length, 0);
});
test('saving creates a new version and marks the old one replaced without overwriting originals', async () => {
  const h = harness();
  const response = await h.request({ action: 'save', draft: { ...draft, sourceNotes: 'Owner correction.', social: 'Corrected public copy.' } });
  assert.equal(response.status, 200);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].data.action, marketing.DRAFT_SAVED_ACTION);
  assert.equal(h.writes[0].data.metadata.parentDraftId, draftId);
  assert.equal(h.writes[1].data.action, review.REVIEW_SUPERSEDED);
  assert.equal(draft.sourceNotes.includes('Built a pavilion'), true);
  const bad = harness(); assert.equal((await bad.request({ action: 'save', draft: { ...draft, assetIds: [nextId] } })).status, 409); assert.equal(bad.writes.length, 0);
});
test('local checks queue the current input hash without granting approval', async () => {
  const h = harness({ context: { review: null } });
  assert.equal((await h.request({ action: 'check' })).status, 200);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].create.metadata.testDraftId, draftId);
  assert.equal(h.writes[0].create.action, review.REVIEW_REQUEST);
  assert.equal(h.writes[0].create.metadata.inputHash, hash);
  assert.equal(h.writes[0].create.metadata.status, 'queued');
});
test('local model transport handles responses, deadlines, oversized output and HTTP failures', async (t) => {
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      const input = JSON.parse(body);
      if (input.mode === 'timeout') { setTimeout(() => response.end('{}'), 100).unref(); return; }
      if (input.mode === 'large') { response.end('x'.repeat(300000)); return; }
      if (input.mode === 'fail') { response.statusCode = 503; response.end('{}'); return; }
      response.end(JSON.stringify({ message: { content: 'ok' } }));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const port = server.address().port;
  const { localReviewRequest } = load('scripts/local-review-request.ts', { 'node:http': require('node:http') });
  assert.equal((await localReviewRequest({}, port, 1000)).message.content, 'ok');
  await assert.rejects(localReviewRequest({ mode: 'fail' }, port, 1000), /HTTP 503/);
  await assert.rejects(localReviewRequest({ mode: 'large' }, port, 1000));
  await assert.rejects(localReviewRequest({ mode: 'timeout' }, port, 10), /timed out/);
});
