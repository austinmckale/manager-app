import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const loaded = new Map();
function load(name) {
  if (loaded.has(name)) return loaded.get(name);
  const exports = {}; loaded.set(name, exports);
  const source = readFileSync(new URL(`../src/lib/publishing/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, Date, AbortSignal, fetch: () => { throw Error('Unexpected network'); }, require: (id) => id.startsWith('@/lib/publishing/') ? load(id.split('/').at(-1)) : require(id) });
  return exports;
}
const api = load('buffer');
const flow = load('buffer-delivery');
const channel = { id: 'fb', name: 'RHI', displayName: 'RHI Pros', service: 'facebook', organization: 'RHI', isQueuePaused: false, isDisconnected: false, isLocked: false };
const post = { id: 'post-1', channelId: 'fb', text: 'Approved social', status: 'draft', dueAt: null, sentAt: null, externalLink: null, assets: [{ id: 'asset', mimeType: 'image/jpeg' }] };
const command = { orgId: 'org', draftId: 'draft', inputHash: 'hash', mode: 'draft', selections: [{ channelId: 'fb', assetIds: ['photo'] }] };
function fixture() {
  const records = new Map(); const calls = [];
  const deps = {
    approved: async () => ({ inputHash: 'hash', draft: { assetIds: ['photo', 'photo2'], social: 'Approved social', googleBusiness: 'Approved Google' } }),
    channels: async () => [channel],
    media: async (ids) => ids.map((id) => `https://private.example/${id}`),
    claim: async (record) => { const old = records.get(record.id); if (old) return { owned: false, record: old }; records.set(record.id, record); return { owned: true, record }; },
    update: async (id, patch) => { const record = { ...records.get(id), ...patch }; records.set(id, record); return record; },
    create: async (input) => { calls.push(input); return post; },
  };
  return { deps, records, calls };
}
test('draft and queue payloads use variables, automatic delivery, explicit safety fields and approved media', async () => {
  for (const mode of ['draft', 'queue']) {
    let payload;
    const result = await api.createBufferPost({ channel, text: post.text, imageUrls: ['https://private.example/photo'], mode }, 'secret-key', async (url, init) => {
      assert.equal(url, 'https://api.buffer.com'); assert.equal(init.headers.Authorization, 'Bearer secret-key'); assert.equal(init.redirect, 'error');
      payload = JSON.parse(init.body);
      return Response.json({ data: { createPost: { __typename: 'PostActionSuccess', post } } });
    });
    const input = payload.variables.input;
    assert.equal(input.saveToDraft, mode === 'draft'); assert.equal(input.mode, 'addToQueue'); assert.equal(input.schedulingType, 'automatic'); assert.equal(input.needsApproval, false);
    assert.equal(input.assets[0].image.url, 'https://private.example/photo'); assert.equal(result.id, 'post-1'); assert.ok(!payload.query.includes(post.text));
    assert.ok(!JSON.stringify(result).includes('secret-key'));
  }
});
test('provider failures never leak provider messages, tokens or private media URLs', async () => {
  await assert.rejects(api.createBufferPost({ channel, text: 'copy', imageUrls: [], mode: 'draft' }, 'secret', async () => Response.json({ data: { createPost: { __typename: 'InvalidInputError', message: 'secret private-url' } } })), (e) => e instanceof api.BufferRejected && !e.message.includes('private-url'));
});
test('unapproved or stale drafts fail before any provider mutation', async () => {
  for (const kind of ['missing', 'stale']) {
    const f = fixture(); f.deps.approved = async () => { if (kind === 'missing') throw Error('Not approved'); return { inputHash: 'changed', draft: {} }; };
    await assert.rejects(flow.sendApprovedToBuffer(command, f.deps)); assert.equal(f.calls.length, 0); assert.equal(f.records.size, 0);
  }
});
test('validates all channels, photo ownership and Google single-photo limit before sending', async () => {
  for (const selections of [[{ channelId: 'other', assetIds: ['photo'] }], [{ channelId: 'fb', assetIds: ['foreign'] }], [{ channelId: 'fb', assetIds: ['photo'] }, { channelId: 'fb', assetIds: ['photo2'] }]]) {
    const f = fixture(); await assert.rejects(flow.sendApprovedToBuffer({ ...command, selections }, f.deps)); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.deps.channels = async () => [{ ...channel, service: 'googlebusiness' }];
  await assert.rejects(flow.sendApprovedToBuffer({ ...command, selections: [{ channelId: 'fb', assetIds: ['photo', 'photo2'] }] }, f.deps)); assert.equal(f.calls.length, 0);
});
test('disconnected and locked channels are blocked; paused queues allow drafts only', async () => {
  for (const flag of ['isDisconnected', 'isLocked', 'isQueuePaused']) {
    const f = fixture(); f.deps.channels = async () => [{ ...channel, [flag]: true }];
    await assert.rejects(flow.sendApprovedToBuffer({ ...command, mode: 'queue' }, f.deps)); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.deps.channels = async () => [{ ...channel, isQueuePaused: true }];
  assert.equal((await flow.sendApprovedToBuffer(command, f.deps))[0].status, 'draft');
});
test('concurrent sends and switching draft/queue or photos never duplicate an approved version/channel', async () => {
  const f = fixture(); await Promise.all([flow.sendApprovedToBuffer(command, f.deps), flow.sendApprovedToBuffer(command, f.deps)]);
  await flow.sendApprovedToBuffer({ ...command, mode: 'queue', selections: [{ channelId: 'fb', assetIds: ['photo2'] }] }, f.deps);
  assert.equal(f.calls.length, 1); assert.equal(f.records.size, 1);
});
test('a timeout stays unknown and automatic repeat mutations are blocked', async () => {
  const f = fixture(); f.deps.create = async () => { f.calls.push('timeout'); throw Error('timeout'); };
  assert.equal((await flow.sendApprovedToBuffer(command, f.deps))[0].status, 'unknown');
  await flow.sendApprovedToBuffer(command, f.deps); assert.equal(f.calls.length, 1);
});
test('approval is rechecked after media preparation, before provider mutation', async () => {
  const f = fixture(); let count = 0;
  f.deps.approved = async () => ({ inputHash: ++count === 1 ? 'hash' : 'changed', draft: { assetIds: ['photo'], social: 'Approved social' } });
  assert.equal((await flow.sendApprovedToBuffer(command, f.deps))[0].status, 'rejected'); assert.equal(f.calls.length, 0);
});
test('Google receives Google copy and chosen photo; partial failures retain per-channel outcomes', async () => {
  const f = fixture(); const google = { ...channel, id: 'gbp', service: 'googlebusiness' };
  f.deps.channels = async () => [channel, google];
  f.deps.create = async (input) => { f.calls.push(input); if (input.channel.id === 'fb') throw Error('timeout'); return { ...post, id: 'google-post', channelId: 'gbp', text: 'Approved Google' }; };
  const result = await flow.sendApprovedToBuffer({ ...command, selections: [...command.selections, { channelId: 'gbp', assetIds: ['photo2'] }] }, f.deps);
  assert.equal(result[0].status, 'unknown'); assert.equal(result[1].status, 'draft'); assert.equal(f.calls[1].text, 'Approved Google'); assert.equal(f.calls[1].imageUrls[0], 'https://private.example/photo2');
});
test('only confirmed sent posts count as published; scheduled and draft posts never do', () => {
  assert.equal(flow.bufferStatus(post), 'draft'); assert.equal(flow.bufferStatus({ ...post, status: 'scheduled' }), 'queued');
  assert.equal(flow.bufferStatus({ ...post, status: 'sent' }), 'unknown'); assert.equal(flow.bufferStatus({ ...post, status: 'sent', sentAt: '2026-10-17T20:00:00Z' }), 'published');
  assert.equal(flow.postPatch({ ...post, externalLink: 'javascript:alert(1)' }).externalLink, null);
});
test('status lookup uses post ID only, with no publishing mutation', async () => {
  const result = await api.readBufferPost('post-1', 'secret', async (_url, init) => { const b = JSON.parse(init.body); assert.match(b.query, /^query /); assert.equal(b.variables.input.id, 'post-1'); return Response.json({ data: { post } }); });
  assert.equal(result.status, 'draft');
});

function routeHarness(options = {}) {
  const calls = [];
  const exports = {};
  const imports = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, zod: require('zod'),
    '@/lib/auth': { requireAuth: async (input) => { assert.equal(input.allowFallback, false); if (options.noAuth) throw Error('Unauthorized'); return { orgId: 'org', userId: 'owner', email: options.client ? 'client' : 'owner' }; } },
    '@/lib/client-portal-policy': { isDashboardOwnerEmail: (email) => email === 'owner' },
    '@/lib/demo': { isDemoMode: () => !!options.demo },
    '@/lib/publishing/types': load('types'),
    '@/lib/publishing/buffer-store': {
      executeBufferSend: async (input, user) => { calls.push({ input, user }); return []; },
      refreshBufferDelivery: async (...args) => { calls.push(args); return {}; },
      testBufferDraft: async (...args) => { calls.push(args); return []; },
    },
  };
  const code = ts.transpileModule(readFileSync(new URL('../src/app/api/publishing/buffer/deliveries/route.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, URL, require: (name) => { if (imports[name]) return imports[name]; throw Error(name); } });
  return { calls, request: (body) => exports.POST(new Request('https://app.rhipros.com/api/publishing/buffer/deliveries', { method: 'POST', headers: { origin: options.crossOrigin ? 'https://other.example' : 'https://app.rhipros.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) };
}
test('Buffer mutations reject cross-origin, signed-out, client and demo requests with no provider calls', async () => {
  for (const [options, status] of [[{ crossOrigin: true }, 403], [{ noAuth: true }, 401], [{ client: true }, 403], [{ demo: true }, 409]]) {
    const h = routeHarness(options); assert.equal((await h.request({ action: 'test' })).status, status); assert.equal(h.calls.length, 0);
  }
});
test('queue requires explicit confirmation, and org/actor always come from authenticated session', async () => {
  const body = { action: 'send', draftId: '10000000-0000-4000-8000-000000000001', inputHash: 'a'.repeat(64), mode: 'queue', queueConfirmed: false, selections: [{ channelId: 'fb', assetIds: ['20000000-0000-4000-8000-000000000001'] }], orgId: 'attacker', userId: 'attacker' };
  const h = routeHarness(); assert.equal((await h.request(body)).status, 400); assert.equal(h.calls.length, 0);
  assert.equal((await h.request({ ...body, queueConfirmed: true })).status, 200); assert.equal(h.calls[0].input.orgId, 'org'); assert.equal(h.calls[0].user, 'owner');
});
