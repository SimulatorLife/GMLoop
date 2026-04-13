/**
 * Enforces the lint/core boundary for `dominantLineEnding` (target-state.md §2.1):
 *
 * `dominantLineEnding` is a shared text utility — it must be defined once in
 * `@gmloop/core` and consumed from there by both the `lint` and `refactor`
 * workspaces. It must NOT be redefined locally inside `rule-base-helpers.ts` or any
 * individual lint rule file.
 *
 * This test catches regressions where someone re-adds the function to the lint
 * workspace, causing the workspaces to drift apart again.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import { assertEquals } from "../assertions.js";

const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
// THIS_DIRECTORY is dist/test/rules/ at runtime; climb up to the workspace root
// (dist/test/rules → dist/test → dist → workspace root), then into src/
const WORKSPACE_ROOT = path.resolve(THIS_DIRECTORY, "../../..");
const RULE_HELPERS_PATH = path.resolve(WORKSPACE_ROOT, "src/rules/gml/rule-base-helpers.ts");

void test("dominantLineEnding is exported from Core (target-state.md §2.1)", () => {
    assertEquals(
        typeof Core.dominantLineEnding,
        "function",
        "Core.dominantLineEnding must be a function — it is the single canonical implementation shared across lint and refactor workspaces."
    );
});

void test("dominantLineEnding is not redefined in lint rule-base-helpers (belongs exclusively in @gmloop/core)", () => {
    const ruleHelpersSource = readFileSync(RULE_HELPERS_PATH, "utf8");

    assertEquals(
        ruleHelpersSource.includes("function dominantLineEnding"),
        false,
        "rule-base-helpers.ts must not define its own dominantLineEnding — the canonical implementation lives in @gmloop/core (target-state.md §2.1). Remove the local copy and use Core.dominantLineEnding instead."
    );
});

void test("Core.dominantLineEnding returns LF for LF-only text", () => {
    assert.strictEqual(Core.dominantLineEnding("line1\nline2\n"), "\n");
});

void test("Core.dominantLineEnding returns CRLF for CRLF-only text", () => {
    assert.strictEqual(Core.dominantLineEnding("line1\r\nline2\r\n"), "\r\n");
});

void test("Core.dominantLineEnding picks the dominant ending when mixed (count-based)", () => {
    // 3 CRLF vs 1 LF → CRLF wins
    assert.strictEqual(Core.dominantLineEnding("a\r\nb\r\nc\r\nd\ne"), "\r\n");
    // 1 CRLF vs 3 LF → LF wins
    assert.strictEqual(Core.dominantLineEnding("a\r\nb\nc\nd\ne"), "\n");
});

void test("Core.dominantLineEnding defaults to LF on tie or empty input", () => {
    assert.strictEqual(Core.dominantLineEnding("no newlines"), "\n");
    assert.strictEqual(Core.dominantLineEnding(""), "\n");
    // equal counts → tie breaks to LF
    assert.strictEqual(Core.dominantLineEnding("a\r\nb\nc"), "\n");
});
