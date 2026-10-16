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
  vm.runInNewContext(code, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unexpected import ${name}`); }, Date, Set, Buffer, process: { env: { AUTH_REQUIRED: '1', AUTH_ALLOWED_EMAILS: 'admin@example.com' } } });
  return exports;
}
const policy = load('src/lib/client-portal-policy.ts');
const emails = ['ryanran321@gmail.com', 'rhisolutions316@gmail.com'];
test('both Ryan addresses share client identity policy; unrelated addresses do not', () => {
  for (const email of emails) assert.equal(policy.isClientPortalEmail(` ${email.toUpperCase()} `), true);
  for (const email of [null, 'someone@gmail.com', 'ryanran321@gmail.com.attacker.test']) assert.equal(policy.isClientPortalEmail(email), false);
});
function portal({ email = emails[0], confirmed = true, error = null, org = 'org', job = 'job', valid = true } = {}) {
  const queries = [];
  const mod = load('src/lib/client-portal.ts', {
    react: { cache: (fn) => fn }, zod: require('zod'), '@/lib/client-portal-policy': policy,
    '@/lib/supabase/server': { createServerSupabase: async () => ({ auth: { getUser: async () => ({ error, data: { user: { id: 'user', email, email_confirmed_at: confirmed ? '2026-10-16' : null } } }) } }) },
    '@/lib/field-intake': { uploadInviteToken: () => 'token', resolveUploadInvite: async () => valid ? { orgId: org, jobId: job } : null },
    '@/lib/prisma': { prisma: { activityLog: { findMany: async (query) => { queries.push(query); return [{ orgId: 'org', jobId: 'job', metadata: { emails, inviteId: '40000000-0000-4000-8000-000000000001' } }]; } } } },
  });
  return { ...mod, queries };
}
test('portal requires a verified server-authenticated Ryan email', async () => {
  assert.equal((await portal().clientPortalUser()).email, emails[0]);
  for (const options of [{ email: 'stranger@example.com' }, { confirmed: false }, { error: new Error('expired') }]) assert.equal(await portal(options).clientPortalUser(), null);
});
test('portal access rejects expired/revoked invites and organization/job mismatches', async () => {
  for (const options of [{ valid: false }, { org: 'other' }, { job: 'other' }]) assert.equal(await portal(options).clientPortalAccess(emails[0]), null);
  const h = portal();
  assert.ok(await h.clientPortalAccess(emails[1]));
  assert.equal(h.queries[0].where.metadata.array_contains[0], emails[1]);
  const denied = portal();
  assert.equal(await denied.clientPortalAccess('stranger@example.com'), null);
  assert.equal(denied.queries.length, 0);
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
