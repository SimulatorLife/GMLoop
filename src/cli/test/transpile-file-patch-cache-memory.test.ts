import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Transpiler } from "@gmloop/transpiler";

import {
    type RuntimeTranspilerPatch,
    type TranspilationContext,
    transpileFile
} from "../src/modules/transpilation/coordinator.js";

function createContext(): TranspilationContext {
    return {
        transpiler: new Transpiler.GmlTranspiler(),
        patches: [],
        metrics: [],
        errors: [],
        lastSuccessfulPatches: new Map(),
        bounds: { maxEntries: 100 },
        totalPatchCount: 0,
        websocketServer: null
    };
}

function measureCachedPatchBytes(cachedPatches: Map<string, RuntimeTranspilerPatch>): number {
    let totalBytes = 0;
    for (const patch of cachedPatches.values()) {
        totalBytes += Buffer.byteLength(patch.js_body, "utf8");
    }
    return totalBytes;
}

void describe("transpileFile patch cache memory control", () => {
    void it("keeps only the latest patch entry for a source file when symbol IDs churn", () => {
        const context = createContext();
        const filePath = "/project/scripts/changing-script.gml";
        const totalIterations = 200;

        for (let index = 0; index < totalIterations; index += 1) {
            const source = `function scr_variant_${index}() {\n    return ${index};\n}\n`;
            const result = transpileFile(context, filePath, source, 3, { verbose: false, quiet: true });
            assert.equal(result.success, true, `iteration ${index} should transpile successfully`);
        }

        const cachedPatchCount = context.lastSuccessfulPatches.size;
        const cachedPatchBytes = measureCachedPatchBytes(context.lastSuccessfulPatches);

        assert.equal(
            cachedPatchCount,
            1,
            "cache should retain only one patch for a single source path despite patch ID churn"
        );
        assert.ok(cachedPatchBytes > 0, "cached patch bytes should be reported");
    });
});
