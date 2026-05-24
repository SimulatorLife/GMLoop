import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Transpiler } from "@gmloop/transpiler";

import { type TranspilationContext, transpileFile } from "../src/modules/transpilation/coordinator.js";

function createContext(): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        bounds: { maxEntries: 50 },
        totalPatchCount: 0,
        websocketServer: null
    };
}

void describe("transpileFile patch dependency metadata", () => {
    void it("records script-call dependencies as canonical patch ids", () => {
        const context = createContext();
        const result = transpileFile(
            context,
            "/project/scripts/use_helper.gml",
            `function use_helper() {
    helper_script();
    helper_script();
    other_script();
}`,
            5,
            { verbose: false, quiet: true }
        );

        assert.ok(result.success, "Transpilation should succeed");
        assert.deepStrictEqual(result.patch?.metadata?.dependencies, [
            "gml/script/helper_script",
            "gml/script/other_script"
        ]);
    });

    void it("omits self-references from dependency metadata", () => {
        const context = createContext();
        const result = transpileFile(
            context,
            "/project/scripts/recursive_script.gml",
            `function recursive_script() {
    recursive_script();
}`,
            3,
            { verbose: false, quiet: true }
        );

        assert.ok(result.success, "Transpilation should succeed");
        assert.deepStrictEqual(result.patch?.metadata?.dependencies, []);
    });
});
