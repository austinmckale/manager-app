import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require(id) { if (id in imports) return imports[id]; throw new Error(`Unexpected import ${id}`); }, Date, URL, AbortSignal, Response, process: { env: {} }, ...globals });
  return exports;
}
test('default local inference uses the GPU and larger images', () => {
  const { localAiSettings } = load('scripts/local-ai-settings.ts');
  const gpu = localAiSettings({});
  assert.equal(gpu.imageSize, 1280);
  assert.equal(gpu.options.num_gpu, 999);
  assert.equal(gpu.options.num_thread, 8);
  for (const env of [{ INTAKE_AI_CPU_ONLY: '1' }, { INTAKE_REVIEW_CPU_ONLY: '1' }]) {
    const s = localAiSettings(env); assert.equal(s.imageSize, 768); assert.equal(s.options.num_gpu, 0); assert.equal(s.options.num_thread, 4);
  }
});
test('failed audio does not prevent the next recording from being transcribed', async () => {
  const { processVoiceQueue } = load('scripts/local-voice-queue.ts');
  const rows = [{ id: 'bad', metadata: { status: 'queued', storageKey: 'original' } }, { id: 'good', metadata: { status: 'queued' } }];
  const saved = new Map();
  const result = await processVoiceQueue(rows, async (row) => { if (row.id === 'bad') throw new Error('private error'); return 'Actual speech'; }, async (row, meta) => saved.set(row.id, meta));
  assert.equal(result.transcribed, 1); assert.equal(result.transcriptionFailed, 1);
  assert.equal(saved.get('good').status, 'transcribed'); assert.equal(saved.get('bad').storageKey, 'original');
  assert.ok(!JSON.stringify(saved.get('bad')).includes('private error'));
});
test('recordings back off and stop automatic retries after three failures', async () => {
  const { processVoiceQueue } = load('scripts/local-voice-queue.ts');
  let calls = 0; let saved;
  const row = { metadata: { status: 'queued', transcriptionAttempts: 2 } };
  await processVoiceQueue([row], async () => { calls++; throw new Error(); }, async (_, meta) => { saved = meta; });
  assert.equal(saved.status, 'failed'); assert.equal(saved.transcriptionAttempts, 3);
  await processVoiceQueue([{ metadata: saved }, { metadata: { status: 'queued', nextRetryAt: new Date(Date.now() + 60000).toISOString() } }], async () => { calls++; return ''; }, async () => {});
  assert.equal(calls, 1);
});
function retryHarness(options = {}) {
  const writes = [];
  const route = load('src/app/api/marketing/processing/retry/route.ts', {
    'next/server': { NextResponse: Response }, zod: require('zod'),
    '@/lib/auth': { requireAuth: async () => { if (options.unauthenticated) throw new Error(); return { email: options.client ? 'client' : 'owner', orgId: 'org', userId: 'owner' }; } },
    '@/lib/client-portal-policy': { isDashboardOwnerEmail: (email) => email === 'owner' }, '@/lib/demo': { isDemoMode: () => options.demo }, '@/lib/intake-audio': { AUDIO_RECEIVED: 'audio' },
    '@/lib/prisma': { prisma: { activityLog: { findFirst: async (q) => { assert.equal(q.where.orgId, 'org'); return options.missing ? null : { id: 'id', metadata: { status: options.queued ? 'queued' : 'failed', storageKey: 'unchanged', transcriptionAttempts: 3 } }; }, updateMany: async (q) => { writes.push(q); return { count: options.raced ? 0 : 1 }; } } } },
  });
  return { writes, post: () => route.POST(new Request('https://app.example/retry', { method: 'POST', headers: { origin: options.crossOrigin ? 'https://other.example' : 'https://app.example', 'content-type': 'application/json' }, body: JSON.stringify({ audioId: '10000000-0000-4000-8000-000000000001' }) })) };
}
test('retry is owner-only, scoped and conditional on a still-failed recording', async () => {
  for (const [options, code] of [[{ unauthenticated: true }, 401], [{ client: true }, 403], [{ crossOrigin: true }, 403], [{ demo: true }, 409], [{ missing: true }, 409], [{ queued: true }, 409], [{ raced: true }, 409]]) assert.equal((await retryHarness(options).post()).status, code);
  const h = retryHarness(); assert.equal((await h.post()).status, 200); assert.equal(h.writes[0].where.metadata.equals, 'failed'); assert.equal(h.writes[0].data.metadata.storageKey, 'unchanged'); assert.equal(h.writes[0].data.metadata.status, 'queued');
});
function intakeDelivery() {
  return load('src/lib/intake-delivery.ts', {
    'node:crypto': require('node:crypto'), zod: require('zod'),
    '@/lib/prisma': { prisma: {} },
    '@/lib/marketing': load('src/lib/marketing.ts', { zod: require('zod') }),
    '@/lib/field-intake': { resolveUploadInvite: async () => null },
  });
}
function alertsHarness({ fail = false, configured = true, sources = [] } = {}) {
  const rows = new Map(sources.map((row) => [row.id, structuredClone(row)])); const posts = [];
  const db = {
    upsert: async (q) => { if (!rows.has(q.where.id)) rows.set(q.where.id, structuredClone(q.create)); else if (q.update.metadata) rows.get(q.where.id).metadata = structuredClone(q.update.metadata); return rows.get(q.where.id); },
    findUnique: async (q) => rows.get(q.where.id) || null,
    findMany: async (q) => {
      const action = q.where.action;
      if (action && typeof action === 'object') {
        const allowed = Array.isArray(action.in) ? action.in : [];
        return [...rows.values()].filter((row) => row.orgId === q.where.orgId && allowed.includes(row.action));
      }
      return [...rows.values()].filter((row) => row.orgId === q.where.orgId && row.action === action && ['pending', 'sending'].includes(row.metadata?.status));
    },
    findFirst: async (q) => { const row = rows.get(q.where.id); return row?.orgId === q.where.orgId ? row : null; },
    updateMany: async (q) => { const row = rows.get(q.where.id); if (!row || JSON.stringify(row.metadata) !== JSON.stringify(q.where.metadata.equals)) return { count: 0 }; row.metadata = structuredClone(q.data.metadata); return { count: 1 }; },
    update: async (q) => { rows.get(q.where.id).metadata = structuredClone(q.data.metadata); },
  };
  const env = { MARKETING_ALERTS_DISCORD_WEBHOOK_URL: configured ? 'https://discord.com/api/webhooks/123456789012345678/AAAAAAAAAAAAAAAAAAAAAAAAAAAA' : '' };
  const mod = load('src/lib/marketing-alerts.ts', { 'node:crypto': require('node:crypto'), zod: require('zod'), '@/lib/prisma': { prisma: { activityLog: db } }, '@/lib/intake-delivery': intakeDelivery() }, { process: { env }, fetch: async (url, options) => { posts.push({ url, body: JSON.parse(options.body) }); if (fail) throw new Error('private transport error'); return Response.json({ id: 'message' }); } });
  return { ...mod, rows, posts };
}
test('Discord destination validation rejects arbitrary hosts, credentials and insecure URLs', () => {
  const h = alertsHarness();
  for (const value of ['http://discord.com/api/webhooks/123456789012345678/AAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'https://discord.com.attacker.test/api/webhooks/123456789012345678/AAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'https://x:y@discord.com/api/webhooks/123456789012345678/AAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'https://discord.com/other']) assert.equal(h.discordAlertUrl(value), null);
  assert.ok(h.discordAlertUrl().endsWith('?wait=true'));
});
test('repeated photo receipts produce one owner alert without private source data or mentions', async () => {
  const h = alertsHarness();
  assert.equal(await h.notifyIntakeReceived('org', 'job', 'invite', 'submission'), true);
  assert.equal(await h.notifyIntakeReceived('org', 'job', 'invite', 'submission'), false);
  assert.equal(h.posts.length, 1); assert.equal(h.posts[0].body.allowed_mentions.parse.length, 0);
  assert.ok(h.posts[0].body.content.includes('https://app.rhipros.com/marketing'));
  assert.ok(!JSON.stringify([...h.rows.values()]).includes('discord.com'));
});
test('Discord failures remain pending for retry and never record provider acceptance', async () => {
  const h = alertsHarness({ fail: true });
  assert.equal(await h.notifyIntakeReceived('org', 'job', 'invite', 'submission'), false);
  const row = [...h.rows.values()][0]; assert.equal(row.metadata.status, 'pending'); assert.equal(row.metadata.providerMessageId, undefined);
  assert.ok(!JSON.stringify(row).includes('private transport error'));
  const disabled = alertsHarness({ configured: false }); await disabled.notifyIntakeReceived('org', 'job', 'invite', 'submission'); assert.equal(disabled.posts.length, 0);
});

test('a worker failure keeps one incident when the alert write is lost', async () => {
  const h = alertsHarness();
  await h.runMarketingAlerts('org', 'failed');
  const health = [...h.rows.values()].find((row) => row.action === 'marketing.worker.health');
  const incidentId = health.metadata.incidentId;
  for (const row of [...h.rows.values()].filter((row) => row.action === 'marketing.owner.alert')) h.rows.delete(row.id);
  await h.runMarketingAlerts('org', 'failed');
  const alerts = [...h.rows.values()].filter((row) => row.action === 'marketing.owner.alert');
  const healthAfter = [...h.rows.values()].find((row) => row.action === 'marketing.worker.health');
  assert.equal(alerts.length, 1);
  assert.equal(healthAfter.metadata.incidentId, incidentId);
  assert.equal(healthAfter.metadata.failing, true);
});

test('an unchanged worker problem alerts once, and recovery alerts once', async () => {
  const h = alertsHarness();
  await h.runMarketingAlerts('org', 'failed'); await h.runMarketingAlerts('org', 'failed');
  assert.equal(h.posts.length, 1); assert.match(h.posts[0].body.content, /needs attention/);
  await h.runMarketingAlerts('org', 'healthy'); await h.runMarketingAlerts('org', 'healthy');
  assert.equal(h.posts.length, 2); assert.match(h.posts[1].body.content, /completed a check again/);
});

test('known submission and review ids become exact links without sending by themselves', () => {
  const h = alertsHarness();
  const submissionId = '20000000-0000-4000-8000-000000000002';
  const draftId = '40000000-0000-4000-8000-000000000004';
  const transcript = 'alarm code 9912 and the raw voice transcript';
  const media = 'https://private.example/storage/v1/object/sign/secret-token';
  assert.equal(h.alertMessage('received', { submissionId }), `RHI Pros — New job submission received. Photos are saved online; local AI processing will follow.\nhttps://app.rhipros.com/marketing?open=${submissionId}`);
  assert.equal(h.alertMessage('ready', { draftId, submissionId }), `RHI Pros — A marketing draft has been saved. It needs your review before client release or publishing.\nhttps://app.rhipros.com/marketing/review/${draftId}`);
  assert.equal(h.alertMessage('received', { submissionId: media }), h.alertMessage('received'));
  assert.equal(h.alertMessage('ready', { draftId: transcript, submissionId: media }).includes(transcript), false);
  assert.equal(h.alertMessage('ready', { draftId: transcript, submissionId: media }).includes('secret-token'), false);
  assert.equal(h.posts.length, 0);
});

test('a receipt or saved draft alerts once to that record and a later poll does not send', async () => {
  const submissionId = '20000000-0000-4000-8000-000000000002';
  const inviteId = '10000000-0000-4000-8000-000000000001';
  const transcript = 'alarm code 9912 and the raw voice transcript';
  const media = 'https://private.example/storage/v1/object/sign/secret-token';
  const delivery = intakeDelivery();
  const draftId = delivery.deliveryId('org', inviteId, submissionId, 'saved-draft');
  const secret = { description: transcript, transcript, url: media, storageKey: media, token: 'capability-token' };
  const received = alertsHarness({ sources: [{ id: 'receipt', orgId: 'org', jobId: '30000000-0000-4000-8000-000000000003', action: 'field.photo.received', metadata: { inviteId, submissionId, ...secret } }] });
  assert.equal((await received.runMarketingAlerts('org')).alertsSent, 1);
  assert.equal(received.posts.length, 1);
  assert.equal(received.posts[0].body.content.split('\n')[1], `https://app.rhipros.com/marketing?open=${submissionId}`);
  assert.equal((await received.runMarketingAlerts('org')).alertsSent, 0);
  assert.equal(received.posts.length, 1);
  const ready = alertsHarness({ sources: [{ id: 'pack', orgId: 'org', jobId: '30000000-0000-4000-8000-000000000003', action: 'marketing.intake.pack.ready', metadata: { inviteId, submissionId, ...secret } }] });
  assert.equal((await ready.runMarketingAlerts('org')).alertsSent, 1);
  assert.equal(ready.posts[0].body.content.split('\n')[1], `https://app.rhipros.com/marketing/review/${draftId}`);
  await ready.runMarketingAlerts('org');
  assert.equal(ready.posts.length, 1);
  for (const h of [received, ready]) {
    const sent = JSON.stringify(h.posts);
    const alerts = JSON.stringify([...h.rows.values()].filter((row) => row.action === 'marketing.owner.alert'));
    for (const privateValue of [transcript, media, 'secret-token', 'capability-token', inviteId]) {
      assert.equal(sent.includes(privateValue), false);
      assert.equal(alerts.includes(privateValue), false);
    }
    assert.equal(h.posts[0].body.allowed_mentions.parse.length, 0);
  }
  const unsafe = alertsHarness({ sources: [{ id: 'unsafe', orgId: 'org', jobId: null, action: 'field.photo.received', metadata: { inviteId, submissionId: media, description: transcript } }] });
  assert.equal((await unsafe.runMarketingAlerts('org')).alertsSent, 1);
  assert.equal(unsafe.posts[0].body.content.split('\n')[1], 'https://app.rhipros.com/marketing');
  assert.equal(JSON.stringify(unsafe.posts).includes(media), false);
  assert.equal(JSON.stringify(unsafe.posts).includes(transcript), false);
});

test('polling with no new owner event does not send a Discord message', async () => {
  const h = alertsHarness();
  assert.equal((await h.runMarketingAlerts('org')).alertsSent, 0);
  await h.runMarketingAlerts('org', 'healthy');
  await h.runMarketingAlerts('org', 'healthy');
  assert.equal(h.posts.length, 0);
  h.alertMessage('received', { submissionId: '20000000-0000-4000-8000-000000000002' });
  assert.equal(h.posts.length, 0);
});
