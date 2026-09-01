/**
 * @file hot-reload-cascade-result-convenience-aliases-removed.test.ts
 *
 * Regression guard: the `HotReloadCascadeResult` type used to expose
 * `totalSymbols`, `maxDistance`, and `hasCircular` directly on the result
 * object as "convenience aliases" for the same values already available on
 * `result.metadata`. Those aliases were a transitional layer that kept the
 * old `result.metadata.totalSymbols` four-segment chain hidden behind a
 * top-level field; they have been retired so every accessor goes through
 * the canonical `metadata` bag.
 *
 * Why this guard exists:
 *   - The producer (`computeHotReloadCascade` in `hot-reload.ts`) used to
 *     return the values twice — once under `metadata` and once at the top
 *     level. The duplicate copy was a backwards-compatibility affordance,
 *     not a behavioural extension.
 *   - The duplicate copy was easy to drift out of sync with `metadata`,
 *     which is why the test files previously asserted both copies matched
 *     (e.g. `assert.equal(result.totalSymbols, result.metadata.totalSymbols)`).
 *   - The formatter (`formatBatchRenamePlanReport` in `rename-preview.ts`)
 *     already had to know that the right shape to read is `metadata.*`;
 *     keeping the aliases only added a second shape for future readers to
 *     guess at.
 *
 * If anyone re-introduces the top-level aliases (in the type, the
 * producer, or by populating them on a mock), the assertions below fail
 * loudly so the cleanup can be re-applied.
 *
 * (target-state.md §2.3, §3.2 — no backwards-compatibility shims; refactor
 * consumers read cascade counters through `metadata`.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Refactor } from "../index.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const TYPES_PATH = path.resolve(REPOSITORY_ROOT, "src/refactor/src/types/refactor-engine-types.ts");
const HOT_RELOAD_PATH = path.resolve(REPOSITORY_ROOT, "src/refactor/src/hot-reload.ts");
const FORBIDDEN_ALIAS_PROPERTIES = ["totalSymbols", "maxDistance", "hasCircular"] as const;

void test("HotReloadCascadeResult type no longer re-publishes the metadata counters", async () => {
    const source = await readFile(TYPES_PATH, "utf8");

    // Slice the file down to the `HotReloadCascadeResult` interface so the
    // `HotReloadCascadeMetadata` type (which legitimately owns those
    // fields) does not trip the assertion.
    const interfaceMatch = source.match(/export\s+interface\s+HotReloadCascadeResult\s*\{[\s\S]*?\n\}/u);
    assert.ok(interfaceMatch, "HotReloadCascadeResult interface must still be defined in refactor-engine-types.ts");

    const interfaceBody = interfaceMatch[0];
    for (const propertyName of FORBIDDEN_ALIAS_PROPERTIES) {
        const propertyPattern = new RegExp(String.raw`\b${propertyName}\s*[:?]`, "u");
        assert.doesNotMatch(
            interfaceBody,
            propertyPattern,
            `HotReloadCascadeResult must not declare a top-level '${propertyName}' alias; ` +
                "read it through `result.metadata.<property>` instead."
        );
    }
});

void test("computeHotReloadCascade does not populate top-level metadata aliases", async () => {
    const source = await readFile(HOT_RELOAD_PATH, "utf8");

    // Both return blocks of `computeHotReloadCascade` must omit the
    // top-level `totalSymbols`/`maxDistance`/`hasCircular` properties so
    // the producer cannot silently re-introduce the duplicated values.
    const functionMatch = source.match(/export\s+async\s+function\s+computeHotReloadCascade[\s\S]*?\n\}/u);
    assert.ok(functionMatch, "computeHotReloadCascade must still be defined in hot-reload.ts");

    const functionBody = functionMatch[0];
    for (const propertyName of FORBIDDEN_ALIAS_PROPERTIES) {
        // The function body must not assign the property at the top level
        // of a returned object literal. The `metadata: { ... }` bag is
        // allowed to keep its own copy because that is the canonical home
        // for these counters.
        const topLevelAssignment = new RegExp(String.raw`\n\s+${propertyName}\s*,`, "u");
        assert.doesNotMatch(
            functionBody,
            topLevelAssignment,
            `computeHotReloadCascade must not return a top-level '${propertyName}' alias; ` +
                "publish the counter once, on `metadata`."
        );
    }
});

void test("computeHotReloadCascade result object only exposes metadata for the counters", async () => {
    const engine = new Refactor.RefactorEngine();
    const result = await engine.computeHotReloadCascade([]);

    for (const propertyName of FORBIDDEN_ALIAS_PROPERTIES) {
        assert.equal(
            propertyName in result,
            false,
            `HotReloadCascadeResult must not expose a top-level '${propertyName}' field; ` +
                "use `result.metadata.<property>` to read the counter."
        );
    }

    assert.ok(result.metadata, "result.metadata must remain present");
    assert.equal(typeof result.metadata.totalSymbols, "number");
    assert.equal(typeof result.metadata.maxDistance, "number");
    assert.equal(typeof result.metadata.hasCircular, "boolean");
});
