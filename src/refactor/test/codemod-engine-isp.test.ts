import assert from "node:assert/strict";
import test from "node:test";

import type {
    CodemodCacheController,
    CodemodEngine,
    CodemodRenameOperations,
    CodemodSemanticProvider,
    CodemodTransformExecutor,
    CodemodWorkspaceEditor
} from "../src/types.js";

/**
 * Validates that the CodemodEngine ISP split produces structurally sound
 * role-focused interfaces and that the composite CodemodEngine extends all of them.
 */

void test("CodemodSemanticProvider is assignable from CodemodEngine", () => {
    const engine = {} as CodemodEngine;
    const provider: CodemodSemanticProvider = engine;
    assert.strictEqual(typeof provider, "object");
});

void test("CodemodTransformExecutor is assignable from CodemodEngine", () => {
    const engine = {} as CodemodEngine;
    const executor: CodemodTransformExecutor = engine;
    assert.strictEqual(typeof executor, "object");
});

void test("CodemodRenameOperations is assignable from CodemodEngine", () => {
    const engine = {} as CodemodEngine;
    const operations: CodemodRenameOperations = engine;
    assert.strictEqual(typeof operations, "object");
});

void test("CodemodWorkspaceEditor is assignable from CodemodEngine", () => {
    const engine = {} as CodemodEngine;
    const editor: CodemodWorkspaceEditor = engine;
    assert.strictEqual(typeof editor, "object");
});

void test("CodemodCacheController is assignable from CodemodEngine", () => {
    const engine = {} as CodemodEngine;
    const controller: CodemodCacheController = engine;
    assert.strictEqual(typeof controller, "object");
});

void test("narrow interfaces compose back to CodemodEngine", () => {
    const narrow = {} as CodemodSemanticProvider &
        CodemodTransformExecutor &
        CodemodRenameOperations &
        CodemodWorkspaceEditor &
        CodemodCacheController;
    const engine: CodemodEngine = narrow;
    assert.strictEqual(typeof engine, "object");
});
