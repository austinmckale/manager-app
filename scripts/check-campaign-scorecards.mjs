import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(file, imports) {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import ${name}`); }, Date, Set, Response, Request, URL, Intl, Number, String }, { filename: file });
  return exports;
}
const card = load("src/lib/campaign-scorecard.ts", { zod: require("zod") });
const reportId = "10000000-0000-4000-8000-000000000001";
const inviteId = "20000000-0000-4000-8000-000000000001";
const row = { id: reportId, name: "Patio campaign", platform: "Meta Ads", campaignId: "abc", source: "Meta export + lead ledger", attribution: "Recorded export window", accountTimeZone: "America/New_York", spend: 200, impressions: 10000, clicks: 100, platformConversions: 12, inquiries: 8, qualifiedLeads: 4, estimates: 3, bookedJobs: 1, collectedRevenue: 1000, targetCpql: 60 };
const report = { periodStart: "2026-10-05", periodEnd: "2026-10-11", dataAsOf: "2026-10-12T14:00:00.000Z", currency: "USD", qualification: "In-area homeowner with a confirmed relevant project.", deduplicated: true, summary: "Four qualified inquiries.", nextSteps: "Check follow-up before scaling.", campaigns: [row] };
test("scorecards calculate measured ratios and preserve zero versus missing", () => {
  assert.equal(card.scorecardSchema.safeParse(report).success, true);
  const metrics = card.campaignMetrics(row); assert.equal(metrics.ctr, 1); assert.equal(metrics.cpc, 2); assert.equal(metrics.cpql, 50); assert.equal(metrics.collectedRoas, 5);
  const zero = card.campaignMetrics({ ...row, spend: 0, clicks: 0, impressions: 0, qualifiedLeads: 0 }); assert.equal(zero.ctr, null); assert.equal(zero.cpc, null); assert.equal(zero.cpql, null); assert.equal(zero.collectedRoas, null);
  assert.equal(card.moneyText(0), "$0.00"); assert.equal(card.moneyText(null), "Unavailable");
});
test("business totals require deduplication and complete inputs", () => {
  assert.equal(card.scorecardTotals(report).cpql, 50);
  const unverified = card.scorecardTotals({ ...report, deduplicated: false }); assert.equal(unverified.spend, 200); assert.equal(unverified.qualifiedLeads, null); assert.equal(unverified.collectedRevenue, null);
  const incomplete = card.scorecardTotals({ ...report, campaigns: [row, { ...row, id: inviteId, campaignId: "other", spend: null, qualifiedLeads: null }] }); assert.equal(incomplete.spend, null); assert.equal(incomplete.cpql, null); assert.equal(incomplete.qualifiedLeads, null);
});
test("invalid dates, duplicate campaigns, negative metrics and impossible qualification counts are rejected", () => {
  for (const change of [{ periodStart: "2026-02-30" }, { periodEnd: "2026-10-01" }, { campaigns: [row, { ...row, id: inviteId }] }, { campaigns: [{ ...row, spend: -1 }] }, { campaigns: [{ ...row, qualifiedLeads: 9 }] }, { campaigns: [{ ...row, clicks: 1.5 }] }]) assert.equal(card.scorecardSchema.safeParse({ ...report, ...change }).success, false);
});
test("recommendations use explicit targets and exports neutralize spreadsheet formulas", () => {
  assert.match(card.campaignDecision(row), /Within/); assert.match(card.campaignDecision({ ...row, targetCpql: 20 }), /Above/); assert.match(card.campaignDecision({ ...row, qualifiedLeads: 0 }), /no qualified leads/); assert.match(card.campaignDecision({ ...row, spend: null }), /Complete/);
  assert.match(card.scorecardCsv({ ...report, campaigns: [{ ...row, name: '=HYPERLINK("evil")' }] }), /'\=HYPERLINK/);
  assert.match(card.scorecardText(report), /not profit/); assert.doesNotMatch(card.scorecardText(report), /12 qualified/);
});
function apiHarness(options = {}) {
  const writes = [];
  const route = load("src/app/api/marketing/performance/route.ts", {
    "next/server": { NextResponse: Response }, "next/cache": { revalidatePath() {} }, zod: require("zod"), "@/lib/campaign-scorecard": card,
    "@/lib/auth": { requireAuth: async () => { if (options.unauthorized) throw new Error("Unauthorized"); return { orgId: "org", userId: "admin", role: options.role || "ADMIN" }; } },
    "@/lib/permissions": { canManageOrg: (role) => role === "OWNER" || role === "ADMIN" }, "@/lib/demo": { isDemoMode: () => !!options.demo },
    "@/lib/field-intake": { uploadInviteToken: () => "token", resolveUploadInvite: async () => options.badInvite ? { orgId: "other" } : { id: inviteId, orgId: "org", expiresAt: "2026-11-15T00:00:00Z" } },
    "@/lib/prisma": { prisma: { activityLog: { findFirst: async (query) => { assert.equal(query.where.orgId, "org"); return options.otherReport ? null : { id: reportId, metadata: report }; }, create: async (query) => { writes.push(query); return { id: reportId }; } } } },
  });
  return { writes, post: (body, origin = "https://app.example.com") => route.POST(new Request("https://app.example.com/api/marketing/performance", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) })) };
}
test("scorecard writes require owner/admin authentication, same origin and live mode", async () => {
  for (const [options, status] of [[{ unauthorized: true }, 401], [{ role: "WORKER" }, 403], [{ demo: true }, 409]]) { const h = apiHarness(options); assert.equal((await h.post({ action: "save", report })).status, status); assert.equal(h.writes.length, 0); }
  const h = apiHarness(); assert.equal((await h.post({ action: "save", report }, "https://other.example.com")).status, 403); assert.equal(h.writes.length, 0);
});
test("saving produces immutable scoped snapshots, while sharing requires an org-owned report and active invite", async () => {
  const h = apiHarness(); assert.equal((await h.post({ action: "save", report, orgId: "forged" })).status, 200); assert.equal(h.writes[0].data.orgId, "org"); assert.equal(h.writes[0].data.action, card.SCORECARD_SAVED);
  for (const [options, status] of [[{ badInvite: true }, 400], [{ otherReport: true }, 404]]) { const bad = apiHarness(options); assert.equal((await bad.post({ action: "share", reportId, inviteId })).status, status); assert.equal(bad.writes.length, 0); }
  const shared = apiHarness(); const response = await shared.post({ action: "share", reportId, inviteId }); assert.equal(response.status, 200); assert.match((await response.json()).url, /\/send-photos\/token\/reports\//); assert.equal(shared.writes[0].data.metadata.inviteId, inviteId);
});
test("a report link cannot read another invite or another organization", async () => {
  for (const wrongInvite of [true, false]) {
    let reads = 0;
    const mod = load("src/lib/shared-scorecards.ts", { zod: require("zod"), "@/lib/campaign-scorecard": card, "@/lib/field-intake": { resolveUploadInvite: async () => ({ id: inviteId, orgId: "org" }) }, "@/lib/prisma": { prisma: { activityLog: { findFirst: async (query) => { assert.equal(query.where.orgId, "org"); reads++; return reads === 1 ? { metadata: { inviteId: wrongInvite ? reportId : inviteId, reportId } } : null; } } } } });
    assert.equal(await mod.readSharedScorecard("token", reportId), null); assert.equal(reads, wrongInvite ? 1 : 2);
  }
});
