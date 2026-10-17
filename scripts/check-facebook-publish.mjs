import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
function load(file) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (id === 'react') return React; if (id === 'react/jsx-runtime') return require('react/jsx-runtime'); if (id.endsWith('status-badge')) return { StatusBadge: (props) => React.createElement('span', null, props.label) }; if (id.endsWith('facebook-publish')) return load('src/components/publishing/facebook-publish.ts'); throw new Error(`Unexpected import ${id}`); } });
  return exports;
}
const logic = load('src/components/publishing/facebook-publish.ts');
const screen = load('src/components/publishing/facebook-publish-screen.tsx');
const draft = {
  id: '10000000-0000-4000-8000-000000000001', jobId: '20000000-0000-4000-8000-000000000001', jobName: 'Reading patio', createdAt: '2026-10-17T12:00:00.000Z',
  caption: 'Finished a pavilion in Reading.', photos: [{ id: '30000000-0000-4000-8000-000000000001', fileName: 'pavilion.jpg', url: null }],
  approval: 'approved', approvalDetail: 'Owner approval matches this saved draft and its current evidence.',
};
const missingFacebook = { status: 'MISSING_CONFIGURATION', statusLabel: 'Missing configuration', note: 'Missing configuration: META_APP_ID, META_APP_SECRET.', externalAccountName: null };

test('setup copy uses the supplied status and never promotes a missing account to connected', () => {
  const setup = logic.facebookSetupCopy(missingFacebook, 'mock');
  assert.equal(setup.ready, false);
  assert.equal(setup.label, 'Missing configuration');
  assert.match(setup.modeNote, /Simulation is on/);
  assert.equal(logic.facebookSetupCopy({ ...missingFacebook, status: 'CONNECTED', statusLabel: 'Connected' }, 'live').modeNote.includes('only after Facebook confirms'), true);
});

test('approval, setup, and an in-flight request block another submission', () => {
  const base = { pending: false, mode: 'live', connectionStatus: 'CONNECTED', approval: 'approved', photoCount: 1, caption: 'Finished a pavilion in Reading.' };
  assert.equal(logic.facebookSubmitBlock(base), null);
  assert.match(logic.facebookSubmitBlock({ ...base, approval: 'missing' }), /approval/i);
  assert.match(logic.facebookSubmitBlock({ ...base, approval: 'superseded' }), /replaced/i);
  assert.match(logic.facebookSubmitBlock({ ...base, connectionStatus: 'EXPIRED' }), /setup is not complete/i);
  assert.match(logic.facebookSubmitBlock({ ...base, pending: true }), /already running/i);
  assert.equal(logic.facebookSubmitBlock({ ...base, mode: 'mock', connectionStatus: 'MISSING_CONFIGURATION' }), null);
});

test('a publication is shown only when Facebook confirms it, and simulation stays separate', () => {
  const published = logic.interpretPublishResponse(true, { ok: true, mode: 'live', results: [{ destination: 'FACEBOOK_PAGE', status: 'PUBLISHED', error: null, deduped: false, mock: false, attemptCount: 1 }] });
  assert.equal(published.kind, 'published');
  const simulation = logic.interpretPublishResponse(true, { ok: true, mode: 'mock', results: [{ destination: 'FACEBOOK_PAGE', status: 'SIMULATED', error: null, deduped: false, mock: true, attemptCount: 1, simulation: { text: 'Finished a pavilion in Reading.', approvalHash: 'abc', photos: [] } }] });
  assert.equal(simulation.kind, 'simulation');
  assert.equal(logic.interpretPublishResponse(true, { ok: true, mode: 'live', results: [{ destination: 'FACEBOOK_PAGE', status: 'PROCESSING', error: null, deduped: false, mock: false, attemptCount: 1 }] }).kind, 'accepted');
  for (const body of [null, { error: 'Owner approval of the exact current draft and source evidence is required before publishing.' }, { ok: false }, { ok: true, mode: 'live', results: [{ destination: 'FACEBOOK_PAGE', status: 'FAILED', error: 'Reconnect Facebook.', deduped: false, mock: false, attemptCount: 1 }] }]) {
    const outcome = logic.interpretPublishResponse(body === null ? false : !body.error && body.ok !== false, body);
    assert.equal(outcome.kind, 'error');
    assert.equal(outcome.message.includes('Published'), false);
  }
});

function render(props) {
  return renderToStaticMarkup(React.createElement(screen.FacebookPublishScreen, props));
}

test('the screen shows Facebook setup, the caption with its photos, and blocks an unapproved draft', () => {
  const html = render({ mode: 'mock', facebook: missingFacebook, drafts: [{ ...draft, approval: 'missing', approvalDetail: 'Owner approval of this exact draft and its current evidence is still required.' }] });
  assert.match(html, /Missing configuration/);
  assert.match(html, /Finished a pavilion in Reading\./);
  assert.match(html, /pavilion\.jpg/);
  assert.match(html, /Facebook post preview/);
  assert.match(html, /still required/);
  assert.match(html, /disabled/);
  assert.equal(html.includes('Published.'), false);
  assert.equal(html.includes('Connected'), false);
});

test('mocked simulation and confirmed publication render as different results', () => {
  const unapproved = render({ mode: 'mock', facebook: missingFacebook, drafts: [{ ...draft, approval: 'missing', approvalDetail: 'Owner approval of this exact draft and its current evidence is still required.' }] });
  const simulation = render({ mode: 'mock', facebook: { status: 'CONNECTED', statusLabel: 'Connected', note: 'Connected.', externalAccountName: 'RHI Pros' }, drafts: [draft], fixture: { ok: true, mode: 'mock', results: [{ destination: 'FACEBOOK_PAGE', status: 'SIMULATED', error: null, deduped: false, mock: true, attemptCount: 1, simulation: { text: 'Finished a pavilion in Reading.', approvalHash: 'abc', photos: [{ id: draft.photos[0].id, fileName: 'pavilion.jpg' }] } }] } });
  assert.match(simulation, /Simulation result/);
  assert.equal(simulation.includes('Published.'), false);
  const published = render({ mode: 'live', facebook: { status: 'CONNECTED', statusLabel: 'Connected', note: 'Connected.', externalAccountName: 'RHI Pros' }, drafts: [draft], fixture: { ok: true, mode: 'live', results: [{ destination: 'FACEBOOK_PAGE', status: 'PUBLISHED', error: null, deduped: false, mock: false, attemptCount: 1 }] } });
  assert.match(published, /Published\./);
  assert.match(published, /Facebook confirmed this post/);
  const failed = render({ mode: 'live', facebook: { status: 'EXPIRED', statusLabel: 'Expired authorization', note: 'Expired authorization. Reconnect this account.', externalAccountName: 'RHI Pros' }, drafts: [draft], fixture: { error: 'Expired authorization. Reconnect this account.' } });
  assert.match(failed, /Reconnect this account/);
  assert.equal(failed.includes('Published.'), false);
  const folder = new URL('../tmp/', import.meta.url);
  mkdirSync(folder, { recursive: true });
  const style = 'body{font-family:Segoe UI,sans-serif;background:#faf8f4;margin:0;padding:24px;color:#0f172a}h1{max-width:32rem;margin:24px auto 8px;font-size:16px}section{max-width:32rem;margin:0 auto 32px;border:1px solid #e2e8f0;border-radius:16px;background:#fff;padding:16px}button{background:#b4411b;color:#fff;border:0;border-radius:12px;padding:12px 16px}button[disabled]{opacity:.5}';
  writeFileSync(new URL('facebook-publish-preview.html', folder), `<!doctype html><html><head><meta charset="utf-8"><title>Facebook publishing preview</title><style>${style}</style></head><body><h1>Missing setup and unapproved draft</h1>${unapproved}<h1>Simulation result</h1>${simulation}<h1>Facebook confirmed the post</h1>${published}<h1>Actionable error</h1>${failed}</body></html>`);
});
