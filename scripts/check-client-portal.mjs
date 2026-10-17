import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, imports = {}) {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected import ${name}`); }, Date, Set, Buffer, process: { env: { AUTH_REQUIRED: '1', AUTH_ALLOWED_EMAILS: 'admin@example.com', FIELD_INTAKE_SECRET: 'portal-test-secret' } } });
  return exports;
}
const policy = load('src/lib/client-portal-policy.ts');
const emails = ['ryanran321@gmail.com', 'rhisolutions316@gmail.com'];
test('both Ryan addresses share client identity policy; unrelated addresses do not', () => {
  for (const email of emails) assert.equal(policy.isClientPortalEmail(` ${email.toUpperCase()} `), true);
  for (const email of [null, 'someone@gmail.com', 'ryanran321@gmail.com.attacker.test']) assert.equal(policy.isClientPortalEmail(email), false);
});
function portal({ email = emails[0], confirmed = true, error = null, job = { id: 'job', orgId: 'org' }, revoked = false, invites = ['40000000-0000-4000-8000-000000000001'] } = {}) {
  const queries = [];
  const writes = [];
  const mod = load('src/lib/client-portal.ts', {
    react: { cache: (fn) => fn }, zod: require('zod'), '@/lib/client-portal-policy': policy,
    '@/lib/permissions': { canManageOrg: (role) => role === 'OWNER' || role === 'ADMIN' },
    '@/lib/supabase/server': { createServerSupabase: async () => ({ auth: { getUser: async () => ({ error, data: { user: { id: 'user', email, email_confirmed_at: confirmed ? '2026-10-16' : null } } }) } }) },
    '@/lib/field-intake': {
      INVITE_CREATED: 'field.invite.created',
      uploadInviteToken: (id) => `${id}.signature`,
      resolveUploadInvite: async (token) => invites.includes(token.split('.')[0]) ? { id: token.split('.')[0], orgId: 'org', jobId: 'job', expiresAt: '2026-12-15T00:00:00.000Z' } : null,
    },
    '@/lib/prisma': { prisma: { job: { findFirst: async () => job }, activityLog: {
      findMany: async (query) => {
        queries.push(query);
        if (query.where.action === 'field.invite.created') return [{ id: '40000000-0000-4000-8000-000000000001' }];
        if (query.where.action === 'client.portal.access' && query.where.orgId) return [{ id: 'membership', orgId: 'org', jobId: 'job', metadata: { emails, inviteId: '40000000-0000-4000-8000-000000000001' } }];
        return [{ id: 'membership', orgId: 'org', jobId: 'job', actorId: 'owner', metadata: { emails, inviteId: '40000000-0000-4000-8000-000000000001' } }];
      },
      findFirst: async (query) => { queries.push(query); return revoked ? { id: 'revocation' } : null; },
      findUnique: async () => ({ metadata: { emails, inviteId: '40000000-0000-4000-8000-000000000001' } }),
      create: async ({ data }) => { writes.push(data); return { id: '50000000-0000-4000-8000-000000000002', ...data }; },
      update: async ({ data }) => { writes.push(data); return data; },
    } } },
  });
  return { ...mod, queries, writes };
}
test('portal requires a verified server-authenticated Ryan email', async () => {
  assert.equal((await portal().clientPortalUser()).email, emails[0]);
  for (const options of [{ email: 'stranger@example.com' }, { confirmed: false }, { error: new Error('expired') }]) assert.equal(await portal(options).clientPortalUser(), null);
});
test('membership survives an expired upload link and stays inside its organization', async () => {
  const expired = portal({ invites: [] });
  const membership = await expired.readClientMembership(emails[1]);
  assert.equal(membership.inviteId, '40000000-0000-4000-8000-000000000001');
  assert.equal(membership.historyInviteIds[0], membership.inviteId);
  assert.equal(expired.queries.some((query) => query.where?.metadata?.array_contains?.[0] === emails[1]), true);
  const renewed = await expired.ensurePortalUpload(membership);
  assert.equal(renewed.invite.id, '50000000-0000-4000-8000-000000000002');
  assert.ok(renewed.historyInviteIds.includes(membership.inviteId));
  assert.equal(await portal({ revoked: true }).readClientMembership(emails[0]), null);
  assert.equal(await portal({ job: null }).readClientMembership(emails[0]), null);
  const denied = portal();
  assert.equal(await denied.readClientMembership('stranger@example.com'), null);
  assert.equal(denied.queries.length, 0);
});
test('revoking portal access uses the authenticated organization, not a supplied email', async () => {
  const h = portal();
  assert.equal(await h.revokeClientPortal({ orgId: 'org', userId: 'owner', role: 'OWNER' }), 1);
  assert.equal(h.writes[0].orgId, 'org');
  assert.equal(h.writes[0].metadata.membershipId, 'membership');
  assert.equal(h.writes[0].metadata.email, undefined);
  await assert.rejects(() => h.revokeClientPortal({ orgId: 'org', userId: 'worker', role: 'WORKER' }));
});
function manager(email, cached, profile = { id: 'owner', orgId: 'org', fullName: 'Austin', email: 'austinmck17@gmail.com', role: 'OWNER', isActive: true }) {
  let profileReads = 0;
  const auth = load('src/lib/auth.ts', {
    '@prisma/client': { Role: { OWNER: 'OWNER', ADMIN: 'ADMIN', WORKER: 'WORKER' } }, react: { cache: (fn) => fn },
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'cookie' }) }) },
    '@/lib/auth-context-cookie': { AUTH_CONTEXT_COOKIE_NAME: 'ctx', parseAuthContextCookieValue: () => cached ? { email, role: 'OWNER' } : null },
    '@/lib/demo': { isDemoMode: () => false }, '@/lib/client-portal-policy': policy,
    '@/lib/prisma': { prisma: { userProfile: { findUnique: async () => { profileReads++; return profile; }, findFirst: async () => null } } },
    '@/lib/supabase/server': { createServerSupabase: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'user', email, email_confirmed_at: '2026-10-16' } } }) } }) },
  });
  return { ...auth, reads: () => profileReads };
}
test('client accounts cannot use manager access even with a legacy owner profile or cached owner context', async () => {
  for (const email of emails) for (const cached of [true, false]) {
    const h = manager(email, cached);
    await assert.rejects(h.requireAuth({ allowFallback: false }));
    assert.equal(h.reads(), 0);
  }
});
test('only Austin gets the dashboard, regardless of legacy allowlist or owner cache', async () => {
  for (const email of ['admin@example.com', 'someone@gmail.com']) for (const cached of [true, false]) {
    const h = manager(email, cached);
    assert.equal(h.isEmailAllowed(email), false);
    await assert.rejects(h.requireAuth({ allowFallback: false }));
    assert.equal(h.reads(), 0);
  }
  for (const email of emails) assert.equal(manager(email, false).isEmailAllowed(email), true);
  assert.equal((await manager('austinmck17@gmail.com', false).requireAuth({ allowFallback: false })).email, 'austinmck17@gmail.com');
  assert.equal((await manager('austinmck17@gmail.com', true).requireAuth({ allowFallback: false })).email, 'austinmck17@gmail.com');
});
test('Austin needs an existing active manager profile; login never creates an owner', async () => {
  for (const profile of [null, { email: 'austinmck17@gmail.com', role: 'WORKER', isActive: true }, { email: 'austinmck17@gmail.com', role: 'OWNER', isActive: false }, { email: 'other@example.com', role: 'OWNER', isActive: true }]) {
    await assert.rejects(manager('austinmck17@gmail.com', false, profile).requireAuth({ allowFallback: false }));
  }
});
test('account history keeps both invitations while a shared link still expires', async () => {
  const oldInvite = '40000000-0000-4000-8000-000000000001';
  const renewedInvite = '50000000-0000-4000-8000-000000000002';
  const firstSubmission = '60000000-0000-4000-8000-000000000003';
  const secondSubmission = '70000000-0000-4000-8000-000000000004';
  const queries = [];
  const history = load('src/lib/intake-history.ts', {
    zod: require('zod'),
    '@/lib/field-intake': { PHOTO_RECEIVED: 'field.photo.received', resolveUploadInvite: async () => null },
    '@/lib/intake-audio': { AUDIO_RECEIVED: 'field.audio.received' },
    '@/lib/intake-delivery': { INTAKE_PACK: 'marketing.intake.pack.ready', packSchema: { safeParse: () => ({ success: false }) } },
    '@/lib/prisma': { prisma: {
      activityLog: { findMany: async (query) => { queries.push(query); return [
        { id: 'a', action: 'field.photo.received', createdAt: new Date('2026-10-01T00:00:00.000Z'), metadata: { inviteId: oldInvite, submissionId: firstSubmission, location: 'Reading', description: 'Pavilion' } },
        { id: 'b', action: 'field.audio.received', createdAt: new Date('2026-10-01T00:10:00.000Z'), metadata: { inviteId: oldInvite, submissionId: firstSubmission, transcript: 'wood ceiling', status: 'transcribed' } },
        { id: 'c', action: 'field.photo.received', createdAt: new Date('2026-11-20T00:00:00.000Z'), metadata: { inviteId: renewedInvite, submissionId: secondSubmission, location: 'Wyomissing', description: 'Porch' } },
        { id: 'd', action: 'field.photo.received', createdAt: new Date('2026-11-21T00:00:00.000Z'), metadata: { inviteId: '80000000-0000-4000-8000-000000000009', submissionId: '90000000-0000-4000-8000-000000000009', location: 'Other' } },
      ]; } },
      fileAsset: { findMany: async (query) => { queries.push(query); return [
        { id: 'photo-old', fileName: 'old.jpg', storageKey: 'org/job/intake/old.jpg', mimeType: 'image/jpeg', tags: [`intake:${oldInvite}`, `submission:${firstSubmission}`] },
        { id: 'photo-new', fileName: 'new.jpg', storageKey: 'org/job/intake/new.jpg', mimeType: 'image/jpeg', tags: [`intake:${renewedInvite}`, `submission:${secondSubmission}`] },
        { id: 'photo-other', fileName: 'other.jpg', storageKey: 'other', mimeType: 'image/jpeg', tags: ['intake:80000000-0000-4000-8000-000000000009', 'submission:90000000-0000-4000-8000-000000000009'] },
      ]; } },
    } },
  });
  const batches = await history.intakeHistoryForInvites({ orgId: 'org', jobId: 'job', historyInviteIds: [oldInvite, renewedInvite] });
  assert.equal(batches.map((batch) => batch.id).join(","), [secondSubmission, firstSubmission].join(","));
  assert.equal(batches.find((batch) => batch.id === firstSubmission).transcript, 'wood ceiling');
  assert.equal(batches.find((batch) => batch.id === firstSubmission).photos[0].id, 'photo-old');
  assert.equal(queries[0].where.orgId, 'org');
  assert.equal(queries[0].where.jobId, 'job');
  const links = load('src/lib/field-intake.ts', {
    'node:crypto': require('node:crypto'), zod: require('zod'), '@/lib/auth': {}, '@/lib/permissions': { canManageOrg: () => false },
    '@/lib/prisma': { prisma: { activityLog: { findFirst: async (query) => {
      if (query.where.action === 'field.invite.revoked') return query.where.metadata.equals === '50000000-0000-4000-8000-000000000008' ? { id: 'revoked' } : null;
      const expiresAt = query.where.id === oldInvite ? '2026-10-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z';
      return { orgId: 'org', job: { id: 'job', orgId: 'org' }, metadata: { expiresAt, label: 'Ryan’s photo upload' } };
    } } } },
  });
  assert.equal(await links.resolveUploadInvite(links.uploadInviteToken(oldInvite)), null);
  assert.equal(await links.resolveUploadInvite(links.uploadInviteToken('50000000-0000-4000-8000-000000000008')), null);
  assert.equal((await links.resolveUploadInvite(links.uploadInviteToken(renewedInvite))).orgId, 'org');
});
