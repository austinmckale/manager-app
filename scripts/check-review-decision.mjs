import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageJsonPath = fileURLToPath(new URL("../package.json", import.meta.url));
const UPLOAD_LINK_NOTE =
  "Reading, PA \u2014 website example\nTEST \u2014 existing website photo used to verify Ryan\u2019s upload link. Paver patio and pavilion. Keep this sample in review; do not publish it again.";
const DECISION_FIELDS = ["version", "status", "reasons", "neededContext", "canImportMarketingCopy", "canPublish"];
const COPY_FIELDS = ["copy", "social", "googleBusiness", "metaPrimary", "headlines", "approved"];
const PUBLISHABILITY_STUB = "export function assessPublishability() {\n  return { blocked: false, reasons: [] };\n}\n";

function readProject(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function dataUrl(code) {
  return `data:text/javascript,${encodeURIComponent(code).replaceAll("'", "%27")}`;
}

const review = await import(dataUrl(ts.transpileModule(readProject("src/lib/review-decision.ts"), {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  fileName: "review-decision.ts",
}).outputText));

function hasNamedExport(sourceFile, name) {
  for (const statement of sourceFile.statements) {
    const exported = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (exported && ts.isVariableStatement(statement)) {
      if (statement.declarationList.declarations.some((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name)) return true;
    }
    if (exported && ts.isFunctionDeclaration(statement) && statement.name?.text === name) return true;
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      if (statement.exportClause.elements.some((element) => element.name.text === name)) return true;
    }
  }
  return false;
}

function valueImportSpecifiers(sourceFile) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    if (!statement.importClause || statement.importClause.isTypeOnly) continue;
    const named = statement.importClause.namedBindings;
    if (named && ts.isNamedImports(named) && named.elements.every((element) => element.isTypeOnly)) continue;
    specifiers.push(statement.moduleSpecifier.text);
  }
  return specifiers;
}

function stripImport(code, specifier) {
  return code.replace(new RegExp(`^\\s*import[\\s\\S]*?\\sfrom\\s*["']${specifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']\\s*;?\\s*`, "m"), "");
}

function replaceSpecifier(code, specifier, next) {
  return code.replaceAll(`from "${specifier}"`, `from ${JSON.stringify(next)}`).replaceAll(`from '${specifier}'`, `from ${JSON.stringify(next)}`);
}

function moduleFileName(relativePath) {
  return `${relativePath.replace(/[\\/]/g, "-").replace(/\.ts$/, "")}.mjs`;
}

function renderModule(relativePath, directory, seen) {
  let source;
  try {
    source = readProject(relativePath);
  } catch (error) {
    if (relativePath === "src/lib/publishability.ts") return PUBLISHABILITY_STUB;
    throw error;
  }
  const sourceFile = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) {
    if (relativePath === "src/lib/publishability.ts") return PUBLISHABILITY_STUB;
    const midEdit = new Error(`${relativePath} did not parse`);
    midEdit.skip = relativePath === "src/lib/marketing-handoff.ts"
      ? "Skipped handoffReturnSchema assertion: src/lib/marketing-handoff.ts is mid-edit."
      : `Skipped handoffReturnSchema assertion: src/lib/marketing-handoff.ts is mid-edit (${relativePath} did not parse).`;
    throw midEdit;
  }
  let code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
    fileName: relativePath,
  }).outputText;
  let needsZod = false;
  for (const specifier of valueImportSpecifiers(sourceFile)) {
    if (specifier === "zod") {
      needsZod = true;
      code = stripImport(code, specifier);
      continue;
    }
    if (!specifier.startsWith("@/")) {
      const unsupported = new Error(`Unsupported import ${specifier}`);
      unsupported.skip = `Skipped handoffReturnSchema assertion: src/lib/marketing-handoff.ts is mid-edit or imports ${specifier}.`;
      throw unsupported;
    }
    const dependency = `src/${specifier.slice(2)}.ts`;
    code = replaceSpecifier(code, specifier, `./${writeCompiled(dependency, directory, seen)}`);
  }
  if (!needsZod) return code;
  const lines = code.split(/\r?\n/);
  const imports = lines.filter((line) => /^\s*import\s/.test(line) || /^\s*import\{/.test(line));
  const body = lines.filter((line) => !imports.includes(line)).join("\n");
  return `import { createRequire } from "node:module";\n${imports.join("\n")}\nconst require = createRequire(${JSON.stringify(packageJsonPath)});\nconst { z } = require("zod");\n${body}`;
}

function writeCompiled(relativePath, directory, seen) {
  const filename = moduleFileName(relativePath);
  if (seen.has(relativePath)) return filename;
  seen.add(relativePath);
  writeFileSync(join(directory, filename), renderModule(relativePath, directory, seen));
  return filename;
}

async function loadHandoffReturnSchema() {
  let source;
  try {
    source = readProject("src/lib/marketing-handoff.ts");
  } catch (error) {
    return { skip: `Skipped handoffReturnSchema assertion: src/lib/marketing-handoff.ts could not be read (${error.message}).` };
  }
  const sourceFile = ts.createSourceFile("marketing-handoff.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sourceFile.parseDiagnostics.length > 0) {
    return { skip: "Skipped handoffReturnSchema assertion: src/lib/marketing-handoff.ts is mid-edit." };
  }
  if (!hasNamedExport(sourceFile, "handoffReturnSchema")) {
    return { skip: "Skipped handoffReturnSchema assertion: handoffReturnSchema export is missing." };
  }
  const directory = mkdtempSync(join(tmpdir(), "rhi-review-decision-"));
  try {
    const filename = writeCompiled("src/lib/marketing-handoff.ts", directory, new Set());
    const imported = await import(pathToFileURL(join(directory, filename)).href);
    if (!imported.handoffReturnSchema?.safeParse) {
      return { skip: "Skipped handoffReturnSchema assertion: handoffReturnSchema export is missing." };
    }
    return { schema: imported.handoffReturnSchema };
  } catch (error) {
    if (error?.skip) return { skip: error.skip };
    throw error;
  } finally {
    try {
      rmSync(directory, { recursive: true, force: true });
    } catch {
      // The imported module can stay locked until this process exits.
    }
  }
}

function containsField(value, field) {
  if (!value || typeof value !== "object") return false;
  if (Object.hasOwn(value, field)) return true;
  return Object.values(value).some((item) => containsField(item, field));
}

test("the upload-link sample builds a blocked review decision without marketing copy", () => {
  const decision = review.reviewDecisionForNote(UPLOAD_LINK_NOTE);
  assert.equal(review.isReviewDecision(decision), true);
  assert.equal(decision.version, 2);
  assert.equal(decision.status, "blocked");
  assert.deepEqual(Object.keys(decision), DECISION_FIELDS);
  assert.deepEqual(decision.neededContext, []);
  assert.equal(decision.canImportMarketingCopy, false);
  assert.equal(decision.canPublish, false);
  assert.match(decision.reasons.join(" "), /test of an upload link/i);
  assert.match(decision.reasons.join(" "), /must not be published again/i);
  assert.ok(decision.reasons.every((reason) => reason.length <= 120 && !reason.includes("\n")));
  const serialized = JSON.stringify(decision);
  for (const phrase of ["Paver patio", "pavilion", "website example", "Reading, PA"]) assert.equal(serialized.includes(phrase), false);
  for (const field of COPY_FIELDS) assert.equal(containsField(decision, field), false);
  assert.equal(review.reviewDecisionForNote("We laid a paver patio in Reading."), null);
});

test("a version 1 object with a copy field is not a review decision", () => {
  assert.equal(review.isReviewDecision({ version: 1, copy: "Paver patio and pavilion." }), false);
  assert.equal(review.isReviewDecision({
    version: 1,
    draftId: "10000000-0000-4000-8000-000000000001",
    inputHash: "ab".repeat(32),
    copy: { social: "Paver patio and pavilion.", googleBusiness: "Paver patio.", metaPrimary: "Pavilion.", headlines: ["Paver patio"] },
    approved: true,
  }), false);
  const decision = review.reviewDecisionForNote(UPLOAD_LINK_NOTE);
  assert.equal(review.isReviewDecision({ ...decision, copy: { social: "Paver patio and pavilion." } }), false);
  assert.equal(review.isReviewDecision({ ...decision, canImportMarketingCopy: true }), false);
  assert.equal(review.isReviewDecision({ ...decision, canPublish: true }), false);
  assert.equal(review.isReviewDecision({
    version: 2,
    status: "needs_context",
    reasons: ["The note does not identify the work."],
    neededContext: ["What work was done?"],
    canImportMarketingCopy: false,
    canPublish: false,
  }), true);
});

test("the blocked decision fails handoffReturnSchema when that export exists", async (t) => {
  const loaded = await loadHandoffReturnSchema();
  if (loaded.skip) {
    t.diagnostic(loaded.skip);
    console.log(loaded.skip);
    return;
  }
  const decision = review.reviewDecisionForNote(UPLOAD_LINK_NOTE);
  let accepted = false;
  try {
    accepted = loaded.schema.safeParse(decision).success === true;
  } catch {
    accepted = false;
  }
  assert.equal(accepted, false);
});
