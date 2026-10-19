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
const findings = load('src/lib/review-findings.ts', {});
const repair = load('src/lib/repair-checked-copy.ts', {});
const copyChecks = load('src/lib/copy-checks.ts', { '@/lib/marketing': marketing, '@/lib/review-findings': findings });
const review = load('src/lib/content-review.ts', { zod: require('zod'), 'node:crypto': require('node:crypto'), '@/lib/marketing': marketing, '@/lib/marketing-evidence': evidence, '@/lib/review-findings': findings, '@/lib/copy-checks': copyChecks });
const publishability = load('src/lib/publishability.ts', {});
const captions = load('src/lib/caption-revision.ts', { zod: require('zod'), 'node:crypto': require('node:crypto') });
const draftId = '10000000-0000-4000-8000-000000000001';
const photoId = '20000000-0000-4000-8000-000000000001';
const nextId = '30000000-0000-4000-8000-000000000001';
const draft = marketing.prepareMarketingDraft({ assetIds: [photoId], notes: ['Built a pavilion in Reading.'] });
const hash = review.contentHash({ draft, originals: 'raw notes' });
const completed = { draftId, inputHash: hash, requestedAt: new Date().toISOString(), status: 'completed', policyVersion: 3, evidence: { version: 1, sources: { notes: '', voice: '', owner: '' }, postType: 'project', photos: [{ assetId: photoId, relevance: 'construction', observations: ['A pavilion.'], concerns: [] }], notes: { facts: [], conflicts: [] }, reasons: [] }, result: { summary: 'Checked against supplied evidence.', findings: [] } };
const blocker = { category: 'facts', severity: 'blocker', detail: 'Unsupported warranty.', evidence: 'Original notes contain no warranty.', suggestion: 'Remove it.' };
test('review identity changes with edited text, selected photos or original evidence', () => {
  const id = review.contentReviewId(draftId, hash);
  assert.equal(id, review.contentReviewId(draftId, hash));
  for (const changed of [{ draft: { ...draft, social: 'Edited' }, originals: 'raw notes' }, { draft: { ...draft, assetIds: [nextId] }, originals: 'raw notes' }, { draft, originals: 'corrected transcript' }]) assert.notEqual(review.contentReviewId(draftId, review.contentHash(changed)), id);
});
test('photo order can drop or reorder photos already on the version', () => {
  assert.equal(review.allowedPhotoSelection([photoId], [photoId, nextId]), true);
  assert.equal(review.allowedPhotoSelection([nextId, photoId], [photoId, nextId]), true);
  assert.equal(review.allowedPhotoSelection([], [photoId]), false);
  assert.equal(review.allowedPhotoSelection([photoId, photoId], [photoId]), false);
  assert.equal(review.allowedPhotoSelection(['40000000-0000-4000-8000-000000000001'], [photoId]), false);
  assert.equal(review.needsResolutionNote([{ severity: 'warning', detail: 'Unsupported warranty.' }]), true);
  assert.equal(review.needsResolutionNote([{ severity: 'warning', detail: 'The image is an existing photo used for verification purposes.' }]), false);
});
test('approval requires completed current review without blockers, pending speech or supersession', () => {
  assert.equal(review.canApproveContent(hash, completed, false, false), true);
  assert.equal(review.canApproveContent(hash, { ...completed, policyVersion: 2 }, false, false), false);
  for (const candidate of [null, { ...completed, status: 'queued' }, { ...completed, status: 'failed' }, { ...completed, inputHash: 'x'.repeat(64) }, { ...completed, result: { ...completed.result, findings: [blocker] } }]) assert.equal(review.canApproveContent(hash, candidate, false, false), false);
  assert.equal(review.canApproveContent(hash, completed, true, false), false);
  assert.equal(review.canApproveContent(hash, completed, false, true), false);
});
test('code checks stop empty copy, external destinations, contact details and repeated headlines', () => {
  for (const change of [{ social: '' }, { landingUrl: 'https://example.com' }, { social: 'Contact customer@private.example' }]) assert.ok(review.copyChecks({ ...draft, ...change }).some((finding) => finding.severity === 'blocker'));
  assert.ok(review.copyChecks({ ...draft, googleHeadlines: ['Same', 'same', 'Same'] }).some((finding) => finding.severity === 'warning' && finding.detail === 'Google headlines repeat.'));
});
test('copy checks block cut-off headlines, repeated descriptions, cloned ads, double spaces and unsupported work claims', () => {
  const claim = 'The caption says RHI Pros did this work, and the notes do not.';
  const cut = review.copyChecks({ ...draft, metaHeadline: 'Pavilion in', imageHeadline: 'Deck buildi', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] });
  assert.ok(cut.some((finding) => finding.category === 'copy' && finding.severity === 'warning' && finding.detail === 'Finish the Meta headline so it does not end on a dangling word.' && finding.evidence && finding.suggestion));
  assert.ok(cut.some((finding) => finding.detail === 'Finish the graphic headline so it does not stop mid-word.'));
  for (const headline of ['Deck build-', 'Pavilion b']) assert.ok(review.copyChecks({ ...draft, imageHeadline: headline, googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] }).some((finding) => finding.detail === 'Finish the graphic headline so it does not stop mid-word.'));
  assert.equal(review.copyChecks({ ...draft, metaHeadline: 'Tell us about your project', imageHeadline: 'Project by RHI Pros', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] }).some((finding) => /dangling word|mid-word/.test(finding.detail)), false);
  const google = review.copyChecks({ ...draft, googleHeadlines: ['A'.repeat(26), 'A'.repeat(25), `${'B'.repeat(25)}.`], googleDescriptions: ['C'.repeat(77), `${'D'.repeat(76)}.`], });
  assert.ok(google.some((finding) => finding.detail === 'Finish Google headline 1 so it is not cut off.'));
  assert.equal(google.some((finding) => finding.detail === 'Finish Google headline 2 so it is not cut off.'), false);
  assert.equal(google.some((finding) => finding.detail === 'Finish Google headline 3 so it is not cut off.'), false);
  assert.ok(google.some((finding) => finding.detail === 'Finish Google description 1 so it is not cut off.'));
  assert.equal(google.some((finding) => finding.detail === 'Finish Google description 2 so it is not cut off.'), false);
  const seeded = review.copyChecks(draft);
  assert.equal(seeded.some((finding) => finding.detail === 'Finish Google headline 2 so it is not cut off.'), false);
  assert.equal(seeded.some((finding) => finding.detail === 'Finish Google headline 3 so it is not cut off.'), false);
  assert.equal(seeded.some((finding) => finding.detail.startsWith('Finish Google description')), false);
  const repeated = review.copyChecks({ ...draft, googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'], googleDescriptions: ['Same description.', ' same description. '] });
  assert.ok(repeated.some((finding) => finding.detail === 'Rewrite the repeated Google description.'));
  assert.equal(review.copyChecks({ ...draft, googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'], googleDescriptions: ['Same description.', 'Different description.'] }).some((finding) => finding.detail === 'Rewrite the repeated Google description.'), false);
  const cloned = review.copyChecks({ ...draft, social: 'Same public post.', metaPrimary: '  Same public post.  ', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] });
  const sameAd = cloned.find((finding) => finding.detail === 'Rewrite the Meta ad so it is not the same as the Facebook post.');
  assert.equal(sameAd.severity, 'warning');
  assert.equal(cloned.some((finding) => finding.severity === 'blocker' && finding.detail === sameAd.detail), false);
  assert.equal(review.copyChecks({ ...draft, social: 'Same public post.', metaPrimary: 'same public post.', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] }).some((finding) => finding.detail === 'Rewrite the Meta ad so it is not the same as the Facebook post.'), false);
  assert.ok(review.copyChecks({ ...draft, imageHeadline: 'Project  by RHI Pros', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] }).some((finding) => finding.detail === 'Remove the double space from the graphic headline.'));
  const unsupported = review.copyChecks({ ...draft, sourceNotes: 'Photos of a finished pavilion.', social: 'Our crew built this pavilion.', googleBusiness: 'We installed the railing.', metaPrimary: 'RHI Pros completed this pavilion.', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] });
  assert.equal(unsupported.filter((finding) => finding.detail === claim && finding.category === 'facts' && finding.severity === 'blocker').length, 1);
  assert.equal(review.copyChecks({ ...draft, sourceNotes: 'Photos of a pavilion.', social: 'Planning a project of your own? Contact RHI Pros.', googleBusiness: 'Have a project in mind?', metaPrimary: 'Tell RHI Pros what you have in mind.', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] }).some((finding) => finding.detail === claim), false);
  assert.equal(review.copyChecks({ ...draft, sourceNotes: 'We built a pavilion.', social: 'We built this pavilion.', googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] }).some((finding) => finding.detail === claim), false);
  assert.equal(review.copyChecks({ ...draft, sourceNotes: 'Photos of a pavilion.', social: `We ${'x'.repeat(41)} built this.`, googleHeadlines: ['RHI Pros', 'Short headline', 'Another headline'] }).some((finding) => finding.detail === claim), false);
  for (const finding of [...cut, ...google, ...repeated]) assert.equal(finding.severity, 'warning');
  for (const finding of [...cloned.filter((finding) => finding.severity === 'blocker'), ...unsupported]) {
    assert.equal(finding.severity, 'blocker');
    assert.ok(finding.evidence.length > 0);
    assert.ok(finding.suggestion.length > 0);
    assert.ok(finding.detail.length < 120);
    assert.equal((finding.detail.match(/\./g) || []).length, 1);
  }
});
test('editorial checks block split descriptions, dangling headlines and double spaces, and only warn when social text matches', () => {
  const headlines = ['RHI Pros', 'Short headline', 'Another headline'];
  const duplicate = review.copyChecks({ ...draft, googleHeadlines: headlines, googleDescriptions: ['Plan a patio project with RHI Pros today.', 'Plan a patio project with RHI Pros today too.'] });
  assert.ok(duplicate.some((finding) => finding.severity === 'warning' && finding.detail === 'Rewrite the repeated Google description.' && finding.suggestion));
  const fragment = 'RHI Pros builds covered patios and pavilions homeowners can use with shade all seasons for';
  assert.equal(fragment.length, 90);
  const split = review.copyChecks({ ...draft, googleHeadlines: headlines, googleDescriptions: [fragment, 'the rest of the outdoor season.'] });
  assert.ok(split.some((finding) => finding.severity === 'warning' && finding.detail === 'Finish Google description 1 so it does not continue into the next one.' && finding.suggestion));
  const dangling = review.copyChecks({ ...draft, googleHeadlines: ['Contractor in', 'Short headline', 'Another headline'] });
  assert.ok(dangling.some((finding) => finding.severity === 'warning' && finding.detail === 'Finish Google headline 1 so it does not end on a dangling word.' && finding.suggestion));
  assert.ok(review.copyChecks({ ...draft, metaHeadline: 'RHI Pros Home Improvement Contractor in', googleHeadlines: headlines }).some((finding) => finding.severity === 'warning' && finding.detail === 'Finish the Meta headline so it does not end on a dangling word.'));
  const curb = review.copyChecks({ ...draft, googleHeadlines: ["Enhance your home's curb", 'Short headline', 'Another headline'] });
  assert.ok(curb.some((finding) => finding.severity === 'warning' && finding.detail === 'Finish Google headline 1 so it does not end on a cut-off phrase.' && finding.suggestion));
  assert.equal(review.copyChecks({ ...draft, metaHeadline: "Enhance your home's curb appeal", googleHeadlines: headlines }).some((finding) => /cut-off phrase|dangling word/.test(finding.detail)), false);
  const spaced = review.copyChecks({ ...draft, social: 'Built a pavilion  in Reading. Contact RHI Pros.', googleHeadlines: headlines });
  assert.ok(spaced.some((finding) => finding.severity === 'blocker' && finding.detail === 'Remove the double space from the Facebook post.' && finding.suggestion));
  const same = 'A finished pavilion in Reading. Tell RHI Pros about your project.';
  const identical = review.copyChecks({ ...draft, social: same, metaPrimary: same, googleHeadlines: headlines });
  assert.ok(identical.some((finding) => finding.severity === 'warning' && finding.detail === 'Rewrite the Meta ad so it is not the same as the Facebook post.' && finding.suggestion));
  assert.equal(identical.some((finding) => finding.severity === 'blocker'), false);
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
  const context = { draftId, inputHash: hash, jobId: 'job', reviewId: nextId, draft: { ...draft, googleHeadlines: ['RHI Pros', 'Project estimate', 'Talk with us'] }, superseded: false, voicePending: false, review: completed, approvedAt: null, ...options.context };
  const tx = { activityLog: { findFirst: async () => null, create: async (query) => { writes.push(query); return { id: nextId }; }, upsert: async (query) => { writes.push(query); return {}; } } };
  const route = load('src/app/api/marketing/review/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, zod: require('zod'),
    '@/lib/auth': { requireAuth: async () => { if (options.unauthenticated) throw new Error('Unauthorized'); return { orgId: 'org', userId: 'owner', email: options.client ? 'rhisolutions316@gmail.com' : 'austinmck17@gmail.com' }; } },
    '@/lib/client-portal-policy': { isDashboardOwnerEmail: (email) => email === 'austinmck17@gmail.com' },
    '@/lib/demo': { isDemoMode: () => options.demo || false }, '@/lib/marketing': marketing, '@/lib/content-review': review, '@/lib/marketing-processing': processing, '@/lib/publishability': publishability, '@/lib/caption-revision': captions,
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
test('a photo cosmetic warning does not require a resolution note', async () => {
  const warning = { ...blocker, category: 'images', severity: 'warning', detail: 'The image is an existing photo used for verification purposes.' };
  const h = harness({ context: { review: { ...completed, result: { ...completed.result, findings: [warning] } } } });
  assert.equal((await h.request(approval)).status, 200);
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
test('fixing copy checks clears ad-line blocks and leaves a real claim block in place', () => {
  const broken = {
    ...draft,
    social: 'We built  a pavilion in Reading.',
    metaHeadline: 'Finished project in',
    imageHeadline: 'Deck  build',
    googleHeadlines: ["Enhance your home's curb", 'Your next outdoor project', 'Your next outdoor project'],
    googleDescriptions: ['Tell RHI Pros what you have in mind for your home and', 'the rest keeps going here.', 'Tell RHI Pros what you have in mind for your home and'],
  };
  const fixed = repair.repairCheckedCopy(broken);
  const details = review.copyChecks(fixed).map((finding) => finding.detail);
  for (const detail of details) assert.equal(/Google headline|Google description|Meta headline|graphic headline|double space/i.test(detail), false, detail);
  assert.equal(fixed.social.includes('  '), false);
  assert.match(fixed.social, /pavilion/);
  assert.equal(findings.cosmeticFinding('Photo abc: The image appears to be an existing photo used for verification purposes, not necessarily showing completed work by our company.'), true);
  assert.equal(findings.cosmeticFinding('Photo abc: No explicit connection to our company team or projects is visible in the image itself.'), true);
  assert.equal(findings.cosmeticFinding('Unsupported claim: the notes do not say RHI built it.'), false);
  assert.equal(repair.repairCheckedCopy({ ...draft, imageHeadline: '' }).imageHeadline, 'Project photos');
  const claim = review.copyChecks({ ...draft, sourceNotes: 'Photos of a finished pavilion.', social: 'Our crew built this pavilion.' });
  assert.equal(claim.filter((finding) => finding.detail === 'The caption says RHI Pros did this work, and the notes do not.' && finding.severity === 'blocker').length, 1);
});
