/**
 * @file math-lengthdir-transforms-reexport-shim-removed.test.ts
 *
 * Regression guard: the `math-lengthdir-transforms.ts` module used to
 * re-export `replaceNode`, `replaceNodeWith`, `findParentEntry`, and
 * `unwrapEnclosingParentheses` from their canonical owners
 * (`math-ast-builders.ts` and `math-ast-mutation.ts`) so callers that
 * imported those helpers through the lengthdir module would keep working.
 *
 * That re-export layer was a backward-compatibility shim, not a behavioural
 * extension: the canonical implementations were always reachable through the
 * original modules, and `math-lengthdir-transforms.ts` itself imported them
 * directly to use them internally. Keeping the duplicate re-export surface
 * only widened the public API of a domain module that never owned those
 * helpers in the first place.
 *
 * Why this guard exists:
 *   - The shim made the `lengthdir` module look like a co-owner of the AST
 *     builders / AST mutation helpers, which violates the
 *     `math-lengthdir-transforms` workspace boundary.
 *   - Two callers (`math-parentheses-cleanup.ts` and `math-scalar-condensing.ts`)
 *     reached those helpers through the shim. They now import the canonical
 *     implementations directly:
 *       - `math-parentheses-cleanup.ts` imports `replaceNodeWith` from
 *         `./math-ast-builders.js`.
 *       - `math-scalar-condensing.ts` imports `unwrapEnclosingParentheses`
 *         through the existing `import * as AST from "./math-ast-mutation.js"`
 *         namespace binding (`AST.unwrapEnclosingParentheses`).
 *   - The other two shim symbols (`replaceNode`, `findParentEntry`) had no
 *     external callers and have been retired outright.
 *
 * If anyone re-introduces a `replaceNode`/`replaceNodeWith`/`findParentEntry`/
 * `unwrapEnclosingParentheses` re-export from `math-lengthdir-transforms.ts`,
 * the assertions below fail loudly so the cleanup can be re-applied.
 *
 * (target-state.md §2.3, §3.2 — no backwards-compatibility shims; the lint
 * workspace routes AST-builder / AST-mutation helpers through their canonical
 * owners.)
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import * as LengthdirTransforms from "../../src/rules/gml/math/math-lengthdir-transforms.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const LENGTHDIR_MODULE_PATH = path.resolve(REPOSITORY_ROOT, "src/lint/src/rules/gml/math/math-lengthdir-transforms.ts");

const FORBIDDEN_SHIM_EXPORTS = [
    "findParentEntry",
    "replaceNode",
    "replaceNodeWith",
    "unwrapEnclosingParentheses"
] as const;

void describe("math-lengthdir-transforms re-export shim removal", () => {
    void it("does not re-export the canonical AST-builder / AST-mutation helpers", () => {
        for (const exportedName of FORBIDDEN_SHIM_EXPORTS) {
            assert.equal(
                exportedName in LengthdirTransforms,
                false,
                `math-lengthdir-transforms must not re-export '${exportedName}'; ` +
                    `import it from its canonical owner (math-ast-builders.js or math-ast-mutation.js) instead.`
            );
        }
    });

    void it("source file has no `export { ... } from` re-export shim lines", async () => {
        const source = await readFile(LENGTHDIR_MODULE_PATH, "utf8");
        const reExportPattern = /export\s*\{[^}]*\}\s*from\s*["'](?:\.\/)?math-ast-(?:builders|mutation)\.js["']/gu;

        assert.equal(
            reExportPattern.test(source),
            false,
            "math-lengthdir-transforms.ts must not re-export bindings from " +
                "math-ast-builders.js or math-ast-mutation.js; the canonical owners are the single source of truth."
        );
    });

    void it("still re-exports its own lengthdir-specific helpers from the public API", () => {
        // Sanity check that the canonical lengthdir surface is unaffected by
        // the shim removal; the domain module still owns these helpers and
        // continues to expose them via the math folder barrel.
        assert.equal(typeof LengthdirTransforms.attemptConvertLengthDir, "function");
        assert.equal(typeof LengthdirTransforms.isIdentityReplacementSafeExpression, "function");
        assert.equal(typeof LengthdirTransforms.matchScaledOperand, "function");
        assert.equal(typeof LengthdirTransforms.isSafeReciprocalCancellationOperand, "function");
    });
});
