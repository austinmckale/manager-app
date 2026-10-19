import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(file, imports) {
  const source = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, URL, require(name) { if (name in imports) return imports[name]; throw new Error(`Unmocked import: ${name}`); } }, { filename: file });
  return exports;
}

const marketing = load("src/lib/marketing.ts", { zod: require("zod") });
const siteCatalog = load("src/lib/website-project-catalog.ts", {});
const older = new Date("2026-01-01T00:00:00.000Z");
const newer = new Date("2026-10-01T00:00:00.000Z");
const photo = (id, description, createdAt, stage = "AFTER") => ({ id, description, area: "Patio", stage, createdAt });
const newestJob = "20000000-0000-4000-8000-000000000001";
const olderJob = "20000000-0000-4000-8000-000000000002";
const thirdJob = "20000000-0000-4000-8000-000000000003";
const orgId = "10000000-0000-4000-8000-000000000001";
const owner = { userId: "40000000-0000-4000-8000-000000000001", orgId, role: "OWNER", email: "austinmck17@gmail.com" };

function catalog(rows, options = {}) {
  const writes = [];
  const queries = [];
  const lib = load("src/lib/website-projects.ts", {
    "node:crypto": require("node:crypto"),
    "@/lib/marketing": marketing,
    "@/lib/website-project-catalog": siteCatalog,
    "@/lib/prisma": { prisma: {
      job: { findMany: async (query) => { queries.push(query); if (options.failRead) throw new Error("database unavailable"); return rows; } },
      activityLog: { upsert: async (query) => { writes.push(query); if (options.failWrite) throw new Error("write failed"); return query; } },
    } },
  });
  return { lib, writes, queries };
}

const sampleRows = [
  { id: newestJob, jobName: "Newest deck", address: "123 Oak Street, Reading, PA 19601", _count: { fileAssets: 2 }, fileAssets: [photo("30000000-0000-4000-8000-000000000011", "New deck boards.", newer, "BEFORE"), photo("30000000-0000-4000-8000-000000000001", "Finished deck with the town view.", newer)] },
  { id: olderJob, jobName: "Older pavilion", address: "Wyomissing, PA", _count: { fileAssets: 1 }, fileAssets: [photo("30000000-0000-4000-8000-000000000002", "Pavilion ceiling and recessed lights.", older)] },
  { id: thirdJob, jobName: "Older bath", address: "45 Elm Street", _count: { fileAssets: 1 }, fileAssets: [photo("30000000-0000-4000-8000-000000000003", "Tile shower.", older)] },
];

test("website projects keep the town and description and prefer finished photos", async () => {
  const { lib, writes, queries } = catalog(sampleRows);
  const first = await lib.rememberWebsiteProjects(orgId);
  const again = await lib.rememberWebsiteProjects(orgId);
  const deck = first.projects.find((project) => project.jobId === newestJob);
  assert.equal(queries[0].where.NOT.categoryTags.has, "photo-dump");
  assert.equal(queries[0].where.fileAssets.some.isPortfolio, true);
  assert.equal(deck.location, "Reading, PA");
  assert.equal(deck.location.includes("123"), false);
  assert.equal(deck.assetIds[0], "30000000-0000-4000-8000-000000000001");
  assert.match(deck.description, /Finished deck/);
  assert.equal(deck.photoCount, 2);
  assert.equal(deck.id, lib.websiteProjectId(orgId, newestJob));
  assert.equal(again.projects[0].id, first.projects[0].id);
  assert.equal(new Set(writes.map((write) => write.where.id)).size, first.projects.length);
  assert.equal(writes.every((write) => write.create.action === "marketing.website.project"), true);
  const streetOnly = first.projects.find((project) => project.jobId === thirdJob);
  assert.equal(streetOnly.location, "");
  assert.match(lib.websiteCaption(deck), /Finished deck/);
  assert.equal(lib.websiteCaption(deck).includes("123 Oak"), false);
  const kitchen = first.projects.find((project) => project.slug === "allentown-kitchen-layout-upgrade");
  assert.equal(kitchen.location, "Allentown, PA");
  // The description is the website's own published summary for that project.
  assert.equal(kitchen.description, siteCatalog.websiteProjectCatalog.find((project) => project.slug === "allentown-kitchen-layout-upgrade").description);
  assert.ok(kitchen.description.length > 20);
  assert.equal(first.projects.filter((project) => project.slug).length, siteCatalog.websiteProjectCatalog.length);
  const draft = marketing.marketingDraftSchema.parse(lib.draftFromWebsiteProject(deck));
  assert.equal(draft.publicLocation, "Reading, PA");
  assert.match(draft.social, /Finished deck/);
  assert.equal(draft.social.includes("123 Oak"), false);
  assert.equal(draft.social.includes("Newest deck"), false);
});

test("an older website project is shuffled ahead of only using the newest", async () => {
  const { lib } = catalog(sampleRows);
  const day = new Date("2026-10-17T22:00:00.000Z");
  const { projects, featured } = await lib.rememberWebsiteProjects(orgId, day);
  assert.equal(projects[0].name, "Newest deck");
  const sameDay = lib.pickShuffledProject(projects, day);
  assert.equal(featured.id, sameDay.id);
  assert.notEqual(featured.name, "Newest deck");
  assert.equal(lib.featureWebsiteProject(projects, featured.id)[0].id, featured.id);
  assert.equal(lib.pickShuffledProject(projects.slice(0, 1))?.name, "Newest deck");
  assert.equal(lib.publicTown("Reading, PA"), "Reading, PA");
});

test("a website project becomes a saved draft and is not published", async () => {
  const { lib } = catalog(sampleRows);
  const created = [];
  const route = load("src/app/api/marketing/website-project/route.ts", {
    "next/server": { NextResponse: Response },
    "next/cache": { revalidatePath() {} },
    zod: require("zod"),
    "@/lib/auth": { requireAuth: async () => owner },
    "@/lib/client-portal-policy": { isDashboardOwnerEmail: (email) => email === owner.email },
    "@/lib/permissions": { canManageOrg: (role) => role === "OWNER" || role === "ADMIN" },
    "@/lib/demo": { isDemoMode: () => false },
    "@/lib/marketing": marketing,
    "@/lib/website-projects": lib,
    "@/lib/prisma": { prisma: {
      fileAsset: { findMany: async (query) => { assert.equal(query.where.job.orgId, orgId); assert.equal(query.where.isPortfolio, true); return query.where.id.in.map((id) => ({ id })); } },
      activityLog: { create: async (query) => { created.push(query); return { id: "50000000-0000-4000-8000-000000000001" }; } },
    } },
  });
  const response = await route.POST(new Request("http://localhost:3107/api/marketing/website-project", { method: "POST", headers: { origin: "http://localhost:3107", "content-type": "application/json" }, body: JSON.stringify({ jobId: olderJob }) }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.draftId, "50000000-0000-4000-8000-000000000001");
  assert.equal(created.length, 1);
  assert.equal(created[0].data.action, "marketing.draft.saved");
  assert.equal(created[0].data.metadata.source, "website-project");
  assert.equal(created[0].data.metadata.publicLocation, "Wyomissing, PA");
  assert.match(created[0].data.metadata.social, /Pavilion ceiling/);
  const saved = marketing.marketingDraftSchema.safeParse(created[0].data.metadata);
  assert.equal(saved.success, true);
  const routeSource = readFileSync(new URL("../src/app/api/marketing/website-project/route.ts", import.meta.url), "utf8");
  assert.equal(routeSource.includes("setPhotoPublication"), false);
  assert.equal(routeSource.includes("publishing/deliver"), false);
});

test("website drafts stay with the owner and are not saved in preview mode", async () => {
  const { lib } = catalog(sampleRows);
  function routeFor(auth, demo = false) {
    return load("src/app/api/marketing/website-project/route.ts", {
      "next/server": { NextResponse: Response },
      "next/cache": { revalidatePath() {} },
      zod: require("zod"),
      "@/lib/auth": { requireAuth: async () => { if (!auth) throw new Error("Unauthorized"); return auth; } },
      "@/lib/client-portal-policy": { isDashboardOwnerEmail: (email) => email === owner.email },
      "@/lib/permissions": { canManageOrg: (role) => role === "OWNER" || role === "ADMIN" },
      "@/lib/demo": { isDemoMode: () => demo },
      "@/lib/marketing": marketing,
      "@/lib/website-projects": lib,
      "@/lib/prisma": { prisma: { fileAsset: { findMany: async () => [] }, activityLog: { create: async () => { throw new Error("should not save"); } } } },
    });
  }
  const request = (jobId = olderJob) => new Request("http://localhost:3107/api/marketing/website-project", { method: "POST", headers: { origin: "http://localhost:3107" }, body: JSON.stringify({ jobId }) });
  assert.equal((await routeFor({ ...owner, email: "ryanran321@gmail.com", role: "OWNER" }).POST(request())).status, 403);
  assert.equal((await routeFor(owner, true).POST(request())).status, 409);
  assert.equal((await routeFor(null).POST(request())).status, 401);
  assert.equal((await routeFor(owner).POST(request("20000000-0000-4000-8000-000000000099"))).status, 404);
  const foreign = await routeFor(owner).POST(new Request("http://localhost:3107/api/marketing/website-project", { method: "POST", headers: { origin: "https://evil.example" }, body: JSON.stringify({ jobId: olderJob }) }));
  assert.equal(foreign.status, 403);
});

test("a catalog write problem still leaves the website projects available", async () => {
  const { lib, writes } = catalog(sampleRows, { failWrite: true });
  const { projects } = await lib.rememberWebsiteProjects(orgId);
  assert.ok(projects.some((project) => project.slug === "reading-paver-patio-buildout"));
  assert.equal(projects.filter((project) => project.jobId).length, 3);
  assert.equal(writes.length, projects.length);
});
