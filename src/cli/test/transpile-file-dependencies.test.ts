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
        sourcePathToPatchIds: new Map(),
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

    void it("excludes event instance-method calls from registered script dependencies", () => {
        const scriptNames = new Set(["known_script"]);
        const context: TranspilationContext = {
            ...createContext(),
            scriptNames,
            transpiler: new Transpiler.GmlTranspiler({
                semantic: Transpiler.createSemanticOracle({ scriptNames })
            })
        };
        const result = transpileFile(
            context,
            "/project/objects/obj_player/Create_0.gml",
            [
                "known_script();",
                "actor_take_damage_type(eDamageType.melee);",
                "var callback = function (value) { return value; };"
            ].join("\n"),
            3,
            { verbose: false, quiet: true }
        );

        assert.ok(result.success, "Transpilation should succeed");
        assert.deepStrictEqual(result.patch?.metadata?.dependencies, ["gml/script/known_script"]);
        assert.match(result.patch?.js_body ?? "", /self\.actor_take_damage_type/);
        assert.doesNotMatch(result.patch?.js_body ?? "", /function\s*\(self\.value\)/);
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

    void it("omits references to sibling functions defined in the same source file", () => {
        const context = createContext();
        const result = transpileFile(
            context,
            "/project/scripts/group_helpers.gml",
            `function primary_helper() {
    sibling_helper();
}

function sibling_helper() {
    return 42;
}`,
            4,
            { verbose: false, quiet: true }
        );

        assert.ok(result.success, "Transpilation should succeed");
        assert.deepStrictEqual(result.patch?.metadata?.dependencies, []);
    });

    void it("keeps each function patch scoped to its own external calls", () => {
        const context = createContext();
        const result = transpileFile(
            context,
            "/project/scripts/group_callbacks.gml",
            `function first_helper(callback) {
    var local_callback;
    local_callback();
    callback();
    first_dependency();
}

function second_helper() {
    second_dependency();
}`,
            10,
            { verbose: false, quiet: true }
        );

        assert.ok(result.success, "Transpilation should succeed");
        assert.deepStrictEqual(
            result.patches?.map((patch) => [patch.id, patch.metadata?.dependencies]),
            [
                ["gml/script/first_helper", ["gml/script/first_dependency"]],
                ["gml/script/second_helper", ["gml/script/second_dependency"]]
            ]
        );
    });
});
