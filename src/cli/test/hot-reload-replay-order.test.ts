import assert from "node:assert";
import { describe, it } from "node:test";

import { orderPatchesForReplay, type RuntimeTranspilerPatch } from "../src/modules/transpilation/index.js";

function createScriptPatch(id: string, dependencies: Array<string> = []): RuntimeTranspilerPatch {
    return {
        kind: "script",
        id,
        js_body: `return "${id}";`,
        sourceText: "",
        version: 1,
        metadata: dependencies.length === 0 ? undefined : { timestamp: 0, dependencies }
    };
}

void describe("hot reload replay ordering", () => {
    void it("reorders cached patches so replay delivers dependencies first", () => {
        const dependencyPatch = createScriptPatch("gml/script/helper");
        const dependentPatch = createScriptPatch("gml/script/player_step", [dependencyPatch.id]);

        const ordered = orderPatchesForReplay([dependentPatch, dependencyPatch]);

        assert.deepStrictEqual(
            ordered.map((patch) => patch.id),
            [dependencyPatch.id, dependentPatch.id],
            "Replay should deliver the dependency patch before the dependent patch"
        );
    });

    void it("preserves insertion order when dependencies cannot be fully resolved", () => {
        const firstPatch = createScriptPatch("gml/script/first", ["gml/script/missing"]);
        const secondPatch = createScriptPatch("gml/script/second");

        const ordered = orderPatchesForReplay([firstPatch, secondPatch]);

        assert.deepStrictEqual(
            ordered.map((patch) => patch.id),
            [firstPatch.id, secondPatch.id],
            "Replay should stay deterministic when dependency metadata references a missing patch"
        );
    });
});
