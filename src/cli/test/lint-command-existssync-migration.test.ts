/**
 * @file lint-command-existssync-migration.test.ts
 *
 * Regression guard: `src/cli/src/commands/lint.ts` previously imported the
 * Node.js-deprecated `fs.existsSync` helper directly from `node:fs` to probe
 * candidate ESLint flat-config files, validate the forced project root
 * supplied via `--path`, and decide whether a CLI target resolves to a real
 * file/directory. Node.js deprecated `fs.existsSync` in favor of stat-based
 * lookups that surface real I/O errors instead of silently returning `false`
 * for permission problems.
 *
 * The CLI workspace already exposes a modern equivalent — `pathExistsSync`
 * from `src/cli/src/shared/path-exists.ts` — that wraps `fs.statSync` in a
 * `try`/`catch` and returns `false` for any stat failure. That preserves the
 * historical `fs.existsSync` contract for callers while routing them through
 * the non-deprecated `stat` primitive. The helper also exposes an optional
 * `fs.Stats` predicate so future call sites can collapse the
 * `existsSync → statSync → isFile()/isDirectory()` chain into a single call.
 *
 * This guard:
 *   1. Verifies that `lint.ts` no longer pulls `existsSync` from `node:fs`.
 *   2. Verifies that `lint.ts` imports `pathExistsSync` from the CLI shared
 *      helper so future call sites do not reach for the deprecated API again.
 *   3. Verifies that the previously-migrated call sites continue to use
 *      `pathExistsSync` rather than regressing to the bare `existsSync` call.
 *
 * If anyone re-imports `fs.existsSync` in `lint.ts`, the assertions below
 * fail loudly so the migration can be re-applied.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const LINT_COMMAND_PATH = path.resolve(REPOSITORY_ROOT, "src/cli/src/commands/lint.ts");

void describe("lint command existsSync migration", () => {
    void it("does not import the deprecated existsSync helper from node:fs", async () => {
        const source = await readFile(LINT_COMMAND_PATH, "utf8");

        // Match an import of the form `import { ..., existsSync, ... } from "node:fs";`
        // so that re-introducing the deprecated helper — even alongside other
        // symbols — fails the assertion below.
        const existsSyncImportPattern = /import\s*\{[^}]*\bexistsSync\b[^}]*\}\s*from\s*["']node:fs["']/u;

        assert.equal(
            existsSyncImportPattern.test(source),
            false,
            "src/cli/src/commands/lint.ts must not import the deprecated fs.existsSync helper. " +
                "Use pathExistsSync from ../shared/path-exists.js instead so callers go through the modern stat-based API."
        );
    });

    void it("imports pathExistsSync from the CLI shared helper", async () => {
        const source = await readFile(LINT_COMMAND_PATH, "utf8");
        const pathExistsSyncImportPattern =
            /import\s*\{\s*pathExistsSync\s*\}\s*from\s*["']\.\.\/shared\/path-exists\.js["']/u;

        assert.ok(
            pathExistsSyncImportPattern.test(source),
            "src/cli/src/commands/lint.ts must import pathExistsSync from ../shared/path-exists.js. " +
                "The shared helper is the canonical replacement for the deprecated fs.existsSync API."
        );
    });

    void it("call sites that previously used existsSync now route through pathExistsSync", async () => {
        const source = await readFile(LINT_COMMAND_PATH, "utf8");
        const pathExistsSyncCallCount = (source.match(/\bpathExistsSync\s*\(/gu) ?? []).length;
        // The migration replaced four call sites in lint.ts:
        //   - `discoverFlatConfig` (flat-config file lookup)
        //   - `resolveForcedProjectRootFromPathOption` (.yyp branch)
        //   - `resolveForcedProjectRootFromPathOption` (general branch)
        //   - `expandLintTargetsForRecovery` (per-target existence probe)
        assert.ok(
            pathExistsSyncCallCount >= 4,
            `Expected at least four pathExistsSync call sites in lint.ts after the migration, found ${pathExistsSyncCallCount}. ` +
                "If new call sites were added, update the regression count below the migration rationale."
        );

        const bareExistsSyncCallPattern = /\bexistsSync\s*\(/gu;
        assert.equal(
            bareExistsSyncCallPattern.test(source),
            false,
            "src/cli/src/commands/lint.ts must not call existsSync directly; route existence checks through pathExistsSync instead."
        );
    });
});
