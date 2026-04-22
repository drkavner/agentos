/**
 * Regression checks for Import agent (server payload normalization + definition resolution).
 * Run from repo root: npm run verify:agent-import
 */
import assert from "node:assert/strict";
import { ApiError } from "../server/apiError";
import { ensureAgentDefinitionsCatalog } from "../server/agentDefinitionsCatalog";
import { normalizeAgentImportPayload, resolveDefinitionIdForImport } from "../server/agentImport";
import { storage } from "../server/storage";

function assertApiError(fn: () => void, code: string) {
  try {
    fn();
    assert.fail("expected throw");
  } catch (e) {
    assert.ok(e instanceof ApiError, `expected ApiError, got ${e}`);
    assert.equal((e as ApiError).code, code);
  }
}

ensureAgentDefinitionsCatalog();
const defs = storage.getAgentDefinitions();
assert.ok(defs.length > 0, "agent definitions catalog must not be empty");
const sampleDef = defs[0]!;
const defName = String(sampleDef.name);

// --- normalizeAgentImportPayload ---
assertApiError(() => normalizeAgentImportPayload(null), "validation_error");
assertApiError(() => normalizeAgentImportPayload("x"), "validation_error");

const flat = normalizeAgentImportPayload({
  displayName: "Flat Import Bot",
  definitionName: defName,
  role: "Engineering",
  llmProvider: "openrouter",
  runtimeModel: "nousresearch/hermes-3-llama-3.1-405b:free",
});
assert.equal(flat.displayName, "Flat Import Bot");
assert.equal(flat.definitionName, defName);
assert.equal(flat.llmProvider, "openrouter");
assert.equal(flat.runtimeModel, "nousresearch/hermes-3-llama-3.1-405b:free");
assert.equal(flat.id, undefined);
assert.equal((flat as any).tenantId, undefined);

const wrappedOuter = normalizeAgentImportPayload({
  import: {
    displayName: "Wrapped",
    definitionName: defName,
  },
});
assert.equal(wrappedOuter.displayName, "Wrapped");

const nested = normalizeAgentImportPayload({
  agent: {
    displayName: "Nested",
    id: 999999,
    tenantId: 42,
    tasksCompleted: 100,
    definitionName: defName,
  },
  definition: { id: sampleDef.id, name: defName },
  runtime: { adapterType: "hermes", command: "hermes", runtimeModel: "custom/model:id" },
});
assert.equal(nested.displayName, "Nested");
assert.equal(nested.definitionId, sampleDef.id);
assert.equal(nested.definitionName, defName);
assert.equal(nested.adapterType, "hermes");
assert.equal(nested.command, "hermes");
assert.equal(nested.runtimeModel, "custom/model:id");
assert.equal(nested.id, undefined);
assert.equal((nested as any).tenantId, undefined);
assert.equal((nested as any).tasksCompleted, undefined);

// --- resolveDefinitionIdForImport ---
const byName = resolveDefinitionIdForImport({ definitionName: defName });
assert.equal(byName, sampleDef.id);

const byId = resolveDefinitionIdForImport({ definitionId: sampleDef.id });
assert.equal(byId, sampleDef.id);

assertApiError(() => resolveDefinitionIdForImport({}), "validation_error");
assertApiError(() => resolveDefinitionIdForImport({ definitionName: "__no_such_role_ever__" }), "validation_error");

console.log("verify-agent-import: all checks passed");
