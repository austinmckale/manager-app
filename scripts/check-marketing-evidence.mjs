import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, imports = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: (id) => id in imports ? imports[id] : require(id), Date, Set, Map, Object, URL, Response, Request, AbortSignal, Buffer, process: { env: { OPENAI_API_KEY: 'synthetic-test-key' } }, fetch: async () => { throw Error('Unexpected network'); } });
  return exports;
}
const evidence = load('src/lib/marketing-evidence.ts');
const marketing = load('src/lib/marketing.ts');
const handoff = load('src/lib/marketing-handoff.ts', { '@/lib/marketing': marketing });
const processing = load('src/lib/marketing-processing.ts');
const pipeline = load('scripts/local-evidence-pipeline.ts', { '../src/lib/marketing-evidence': evidence, './local-review-request': { localReviewRequest() { throw Error('Unexpected local AI'); } }, './local-ai-settings': { localAiSettings: () => ({ options: {} }) } });
const photoId = '20000000-0000-4000-8000-000000000001';
const nextPhotoId = '20000000-0000-4000-8000-000000000002';
const draftId = '10000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const sources = { notes: 'Reading', voice: 'We laid a paver patio.', owner: '' };
const notes = { facts: [{ source: 'voice', quote: 'We laid a paver patio.', fact: 'Crew laid a patio.' }], conflicts: [] };
const photo = { assetId: photoId, relevance: 'construction', observations: ['A paver patio is visible.'], concerns: [] };
const validEvidence = () => evidence.assessEvidence({ postType: 'project', photos: [photo], notes, sources, assetIds: [photoId] });
const response = (value) => ({ message: { content: JSON.stringify(value) } });

test('dog photos plus a microphone test are held with no invented construction', () => {
  const result = evidence.assessEvidence({ postType: 'project', photos: [{ ...photo, relevance: 'unrelated', observations: ['A golden retriever on grass.'] }], notes: { facts: [], conflicts: [] }, sources: { notes: '', voice: "testing testing, microphone test", owner: '' }, assetIds: [photoId] });
  assert.ok(result.reasons.some((reason) => /relevant photo/.test(reason)));
  assert.ok(result.reasons.some((reason) => /No usable project facts/.test(reason)));
});
test('real work can proceed without a voice recording; pending voice cannot', () => {
  assert.equal(validEvidence().reasons.length, 0);
  assert.equal(evidence.assessEvidence({ postType: 'project', photos: [photo], notes: { facts: [], conflicts: [] }, sources: { notes: '', voice: '', owner: '' }, assetIds: [photoId] }).reasons.length, 0);
  assert.ok(evidence.assessEvidence({ postType: 'project', photos: [photo], notes, sources, assetIds: [photoId], voicePending: true }).reasons.some((reason) => /transcription/.test(reason)));
});
test('every photo, conflicts, privacy concerns and invented source quotes block drafting', () => {
  for (const change of [{ assetIds: [photoId, nextPhotoId] }, { photos: [photo, photo] }, { notes: { ...notes, conflicts: ['Voice says unfinished, typed notes say finished.'] } }, { photos: [{ ...photo, concerns: ['Customer address visible.'] }] }, { notes: { facts: [{ source: 'voice', quote: 'We built a deck.', fact: 'Deck' }], conflicts: [] } }]) {
    assert.ok(evidence.assessEvidence({ postType: 'project', photos: [photo], notes, sources, assetIds: [photoId], ...change }).reasons.length);
  }
});
test('personality posts require explicit owner context; job facts use original quotes rather than model summaries', () => {
  const result = evidence.assessEvidence({ postType: 'company_life', photos: [{ ...photo, relevance: 'company_life' }], notes, sources, assetIds: [photoId] });
  assert.ok(result.reasons.some((reason) => /owner notes/.test(reason)));
  const facts = evidence.evidenceFacts(validEvidence());
  assert.ok(facts.some((fact) => fact.text === sources.voice));
  assert.ok(!facts.some((fact) => fact.text === 'Crew laid a patio.'));
});
test('inspection passes raw voice and owner corrections to each photo and inspects beyond the first three', async () => {
  const calls = [];
  const photos = Array.from({ length: 5 }, (_, index) => ({ id: `20000000-0000-4000-8000-00000000000${index + 1}`, image: `image-${index}` }));
  const result = await pipeline.inspectSubmission({ model: 'test', sources, postType: 'project', photos }, async (body) => { calls.push(body); return response(calls.length === 1 ? notes : { relevance: 'construction', observations: ['Paver patio.'], concerns: [] }); });
  assert.equal(calls.length, 6);
  assert.equal(result.photos.length, 5);
  assert.equal(result.reasons.length, 0);
  for (const call of calls) assert.ok(JSON.stringify(call.messages).includes(sources.voice));
  assert.equal(calls[5].messages[1].images[0], 'image-4');
});
test('malformed model inspection never becomes a pass', async () => {
  await assert.rejects(pipeline.inspectSubmission({ model: 'test', sources, postType: 'project', photos: [{ id: photoId, image: 'image' }] }, async () => response({ facts: 'bad' })));
});
test('claim audits must cover every exact field with existing evidence; changed and unsupported copy is rejected', () => {
  const copy = { social: 'We laid a paver patio.', googleHeadlines: ['Paver patio'], publicLocation: '' };
  const fields = Object.entries(evidence.publicFields(copy)).map(([field, text]) => ({ field, text, supported: true, factIds: ['note:0'], issues: [] }));
  assert.equal(evidence.auditIssues(copy, validEvidence(), { fields }).length, 0);
  for (const changed of [[], fields.slice(1), [...fields, fields[0]], fields.map((field) => ({ ...field, factIds: ['invented'] })), fields.map((field) => ({ ...field, supported: false })), fields.map((field) => ({ ...field, text: 'Other copy' }))]) assert.ok(evidence.auditIssues(copy, validEvidence(), { fields: changed }).length);
  assert.equal(evidence.checkedFieldsMatch(copy, evidence.publicFields(copy)), true);
  assert.equal(evidence.checkedFieldsMatch({ ...copy, social: 'Lifetime warranty.' }, evidence.publicFields(copy)), false);
});
test('chat round trip preserves originals, photos and destination and rejects stale or injected fields', () => {
  const draft = marketing.prepareMarketingDraft({ assetIds: [photoId], notes: ['Private original notes'] });
  const json = { version: 1, draftId, inputHash: hash, copy: { ...handoff.handoffCopy(draft), social: 'An improved patio description.' } };
  const imported = handoff.importChatReview(JSON.stringify(json), draftId, hash, draft);
  assert.equal(imported.social, json.copy.social);
  assert.equal(imported.sourceNotes, draft.sourceNotes);
  assert.equal(imported.landingUrl, draft.landingUrl);
  assert.deepEqual(imported.assetIds, draft.assetIds);
  for (const bad of [{ ...json, inputHash: 'b'.repeat(64) }, { ...json, approved: true }, { ...json, copy: { ...json.copy, sourceNotes: 'Overwrite evidence' } }, { ...json, copy: { social: 'Missing fields' } }]) assert.throws(() => handoff.importChatReview(JSON.stringify(bad), draftId, hash, draft));
});
test('processing defaults to off, and a reserved-call cap blocks additional requests', async () => {
  assert.equal(processing.processingSettingsSchema.parse({}).enabled, false);
  let usage = { day: '2026-10-17', calls: 0, inputTokens: 0, outputTokens: 0 };
  const db = { $transaction: async (fn) => fn({ activityLog: { upsert: async () => ({ metadata: usage }), update: async ({ data }) => { usage = data.metadata; } } }) };
  await processing.reserveApiCall(db, 'org', 1, new Date('2026-10-17T12:00:00Z'));
  await assert.rejects(processing.reserveApiCall(db, 'org', 1, new Date('2026-10-17T12:00:00Z')), /Daily AI call limit/);
  assert.equal(usage.calls, 1);
});
test('hybrid uses the official endpoint, structured output and inline images without exposing keys to the result', async () => {
  let call;
  const adapter = load('scripts/marketing-ai-request.ts', { '../src/lib/marketing-processing': { processingSettings: async () => ({ enabled: true, mode: 'hybrid', dailyCallLimit: 3 }), reserveApiCall: async () => 'usage' }, './local-review-request': { localReviewRequest() { throw Error('unexpected local'); } } });
  const request = adapter.marketingAiRequest({}, 'org', 'hybrid', false, async (url, init) => { call = { url, init }; return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"facts":[]}' }] }] }); });
  const result = await request({ model: 'test-model', format: { type: 'object', properties: { facts: { type: 'array', items: { type: 'string' } } } }, messages: [{ role: 'user', content: 'Inspect', images: ['encoded-image'] }] });
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(call.init.body);
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.input[0].content[1].image_url, 'data:image/jpeg;base64,encoded-image');
  assert.ok(!JSON.stringify(result).includes('synthetic-test-key'));
});

test('paused and manual modes never call a paid provider, and incomplete replies fail closed', async () => {
  let calls = 0;
  const adapter = load('scripts/marketing-ai-request.ts', { '../src/lib/marketing-processing': { processingSettings: async () => ({ enabled: false, mode: 'hybrid', dailyCallLimit: 3 }), reserveApiCall: async () => 'usage' }, './local-review-request': {} });
  const fetcher = async () => { calls++; return Response.json({ status: 'incomplete', output: [] }); };
  await assert.rejects(adapter.marketingAiRequest({}, 'org', 'hybrid', false, fetcher)({}), /paused/);
  await assert.rejects(adapter.marketingAiRequest({}, 'org', 'manual', true, fetcher)({}), /disabled/);
  assert.equal(calls, 0);
  await assert.rejects(adapter.marketingAiRequest({}, 'org', 'hybrid', true, fetcher)({ model: 'test', format: {}, messages: [] }), /incomplete/);
  assert.equal(calls, 1);
});

function routeHarness(file, { unauthenticated = false, client = false, demo = false, row = null } = {}) {
  const writes = [];
  const db = { activityLog: { findFirst: async (query) => query.where.action === evidence.GENERATION_ACTION ? row : null, updateMany: async (query) => { writes.push(query); return { count: 1 }; }, create: async (query) => { writes.push(query); }, upsert: async (query) => { writes.push(query); } } };
  db.$transaction = async (fn) => fn(db);
  const route = load(file, { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, '@/lib/auth': { requireAuth: async () => { if (unauthenticated) throw Error(); return { orgId: 'org', userId: 'owner', email: client ? 'client' : 'owner' }; } }, '@/lib/client-portal-policy': { isDashboardOwnerEmail: (email) => email === 'owner' }, '@/lib/demo': { isDemoMode: () => demo }, '@/lib/prisma': { prisma: db }, '@/lib/marketing-evidence': evidence, '@/lib/marketing-processing': processing });
  return { writes, request: (body, crossOrigin = false) => route.POST(new Request('https://app.rhipros.com/api/test', { method: 'POST', headers: { origin: crossOrigin ? 'https://other.example' : 'https://app.rhipros.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) };
}
test('processing controls and context corrections reject cross-origin, unauthenticated, client and demo mutations', async () => {
  for (const file of ['src/app/api/marketing/evidence/route.ts', 'src/app/api/marketing/processing/settings/route.ts']) {
    for (const [options, status] of [[{ unauthenticated: true }, 401], [{ client: true }, 403], [{ demo: true }, 409]]) { const h = routeHarness(file, options); assert.equal((await h.request({ action: 'test' })).status, status); assert.equal(h.writes.length, 0); }
    const h = routeHarness(file); assert.equal((await h.request({ action: 'test' }, true)).status, 403); assert.equal(h.writes.length, 0);
  }
});
test('one-shot tests leave automatic processing off; held corrections preserve history and request the same submission', async () => {
  const settings = routeHarness('src/app/api/marketing/processing/settings/route.ts');
  assert.equal((await settings.request({ action: 'test' })).status, 200);
  assert.equal(settings.writes[0].create.metadata.enabled, false);
  assert.ok(settings.writes[0].create.metadata.testRequestedAt);
  const submissionId = '30000000-0000-4000-8000-000000000003';
  const row = { id: draftId, jobId: null, metadata: { inviteId: draftId, submissionId, status: 'held', attempts: 1, runningAt: null, nextRetryAt: null, error: null, ownerNotes: '', postType: 'project', evidence: validEvidence(), issues: ['Needs context'] } };
  const h = routeHarness('src/app/api/marketing/evidence/route.ts', { row });
  assert.equal((await h.request({ id: draftId, ownerNotes: 'We laid the paver patio.', postType: 'project' })).status, 200);
  assert.equal(h.writes[0].data.metadata.status, 'queued');
  assert.equal(h.writes[0].data.metadata.evidence, undefined);
  assert.equal(h.writes[1].data.metadata.previous.status, 'held');
  assert.equal(h.writes[2].create.metadata.testSubmissionId, submissionId);
  assert.equal(h.writes[2].create.metadata.enabled, false);
});
