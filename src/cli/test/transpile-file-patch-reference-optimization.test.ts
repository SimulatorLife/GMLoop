/**
 * Contract tests for the per-patch reference-resolution path in `transpileFile`.
 *
 * The watch pipeline emits one patch per top-level function in a multi-function
 * script. The optimised path computes a per-function reference map from the
 * effective AST once and reuses the same map for every patch instead of
 * re-walking the AST for each patch. These tests pin the behavioural contract
 * the optimisation has to preserve: per-patch dependencies stay correct, and
 * single-patch files keep using the file-wide `effectiveReferences` set.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Transpiler } from "@gmloop/transpiler";

import { type TranspilationContext, transpileFile } from "../src/modules/transpilation/coordinator.js";

/**
 * Synthesises a multi-function GML script where each function calls a fixed
 * set of distinct helpers. The number of functions scales linearly with the
 * `functionCount` parameter so the suite can exercise "wide" multi-function
 * files that benefit most from the per-function reference map.
 */
function buildMultiFunctionScript(functionCount: number): string {
    const lines: Array<string> = [];
    for (let index = 0; index < functionCount; index += 1) {
        lines.push(
            `function helper_${index}(value) {`,
            `    clamp_value(value);`,
            `    transform_value(value);`,
            `    return helper_${index}_inner(value);`,
            `}`,
            `function helper_${index}_inner(value) {`,
            `    return value + ${index};`,
            `}`,
            ""
        );
    }

    return lines.join("\n");
}

function createContext(): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        sourcePathToPatchIds: new Map(),
        bounds: { maxEntries: 50 },
        totalPatchCount: 0,
        websocketServer: null
    };
}

void describe("transpileFile multi-function patch reference optimization", () => {
    void it("single-function scripts skip the per-function map and reuse effectiveReferences", () => {
        const source = [
            "function single_function(value) {",
            "    clamp_value(value);",
            "    transform_value(value);",
            "    return value;",
            "}"
        ].join("\n");
        const context = createContext();
        const result = transpileFile(context, "/project/scripts/single_helper.gml", source, source.split("\n").length, {
            verbose: false,
            quiet: true
        });

        assert.ok(result.success, "Transpilation should succeed");
        assert.deepStrictEqual(result.patch?.metadata?.dependencies, [
            "gml/script/clamp_value",
            "gml/script/transform_value"
        ]);
    });

    void it("multi-function scripts scope per-patch dependencies to the function body", () => {
        // Sanity check on the per-function map: when a multi-function script
        // emits separate patches for each top-level function, the outer
        // helper patches must record external script calls and must exclude
        // sibling function references.
        const source = buildMultiFunctionScript(4);
        const context = createContext();
        const result = transpileFile(
            context,
            "/project/scripts/group_of_helpers.gml",
            source,
            source.split("\n").length,
            {
                verbose: false,
                quiet: true
            }
        );

        assert.ok(result.success, "Transpilation should succeed");
        assert.ok(result.patches && result.patches.length > 1, "Multi-function script should emit multiple patches");

        // Only the outer helper_<index> patches call clamp_value/transform_value;
        // the inner helpers do not.
        const outerHelperPatches = (result.patches ?? []).filter((patch) => /^gml\/script\/helper_\d+$/.test(patch.id));
        assert.ok(outerHelperPatches.length > 0, "Expected outer helper patches matching gml/script/helper_<index>");

        for (const patch of outerHelperPatches) {
            const dependencies = patch.metadata?.dependencies ?? [];
            assert.ok(
                dependencies.includes("gml/script/clamp_value"),
                `Function patch ${patch.id} should depend on clamp_value`
            );
            assert.ok(
                dependencies.includes("gml/script/transform_value"),
                `Function patch ${patch.id} should depend on transform_value`
            );
            // Sibling helper references must not be recorded as runtime dependencies.
            for (const dependency of dependencies) {
                if (dependency.startsWith("gml/script/helper_")) {
                    assert.fail(
                        `Function patch ${patch.id} recorded sibling function ${dependency} as a runtime dependency`
                    );
                }
            }
        }
    });
});
