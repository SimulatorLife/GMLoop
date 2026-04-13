/**
 * Tests for dependency tracking in the GML transpiler.
 *
 * The emitter collects script-call symbols during the single emission pass.
 * These are exposed via `GmlToJsEmitter.getDependencies()` and attached to
 * `PatchMetadata.dependencies` by all three `GmlTranspiler` transpile methods.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";

import { Transpiler } from "../index.js";
import type { CallExpressionNode } from "../src/emitter/ast.js";

type SemanticAnalyzers = ConstructorParameters<typeof Transpiler.GmlToJsEmitter>[0];

/**
 * Return the callee identifier name from a CallExpression when the callee is
 * a plain `Identifier` node, otherwise return `null`.
 */
function resolveCalleeIdentifierName(node: CallExpressionNode): string | null {
    const callee = node.object;
    if (callee.type === "Identifier") {
        return callee.name;
    }
    return null;
}

/**
 * Build a mock semantic oracle that classifies a given set of names as scripts
 * and returns SCIP-style symbol IDs for them.
 */
function makeScriptOracle(scriptNames: ReadonlySet<string>): SemanticAnalyzers {
    const base = Transpiler.createSemanticOracle();
    return Object.assign(Object.create(base), {
        callTargetKind(node: CallExpressionNode) {
            const name = resolveCalleeIdentifierName(node);
            if (name !== null && scriptNames.has(name)) {
                return "script";
            }
            return base.callTargetKind(node);
        },
        callTargetSymbol(node: CallExpressionNode) {
            const name = resolveCalleeIdentifierName(node);
            if (name !== null && scriptNames.has(name)) {
                return `gml/script/${name}`;
            }
            return null;
        }
    } as Partial<SemanticAnalyzers>);
}

void describe("GmlToJsEmitter.getDependencies()", () => {
    void it("returns an empty set before emit is called", () => {
        const emitter = new Transpiler.GmlToJsEmitter(Transpiler.createSemanticOracle());
        assert.equal(emitter.getDependencies().size, 0);
    });

    void it("returns an empty set when the program contains no script calls", () => {
        const ast = Parser.GMLParser.parse("var x = 1 + 2;");
        const emitter = new Transpiler.GmlToJsEmitter(Transpiler.createSemanticOracle());
        emitter.emit(ast);
        assert.equal(emitter.getDependencies().size, 0);
    });

    void it("collects a single script symbol during emission", () => {
        const sem = makeScriptOracle(new Set(["scr_move"]));
        const ast = Parser.GMLParser.parse("scr_move(x, y);");
        const emitter = new Transpiler.GmlToJsEmitter(sem);
        emitter.emit(ast);

        const deps = emitter.getDependencies();
        assert.equal(deps.size, 1);
        assert.ok(deps.has("gml/script/scr_move"));
    });

    void it("collects multiple distinct script symbols", () => {
        const sem = makeScriptOracle(new Set(["scr_move", "scr_attack", "scr_damage"]));
        const ast = Parser.GMLParser.parse("scr_move(1); scr_attack(target); scr_damage(10);");
        const emitter = new Transpiler.GmlToJsEmitter(sem);
        emitter.emit(ast);

        const deps = emitter.getDependencies();
        assert.equal(deps.size, 3);
        assert.ok(deps.has("gml/script/scr_move"));
        assert.ok(deps.has("gml/script/scr_attack"));
        assert.ok(deps.has("gml/script/scr_damage"));
    });

    void it("deduplicates repeated calls to the same script symbol", () => {
        const sem = makeScriptOracle(new Set(["scr_move"]));
        const ast = Parser.GMLParser.parse("for (var i = 0; i < 3; i++) { scr_move(i); }");
        const emitter = new Transpiler.GmlToJsEmitter(sem);
        emitter.emit(ast);

        const deps = emitter.getDependencies();
        assert.equal(deps.size, 1, "Repeated calls to the same script should be deduplicated");
        assert.ok(deps.has("gml/script/scr_move"));
    });

    void it("does not include builtin function calls in dependencies", () => {
        const ast = Parser.GMLParser.parse("var n = abs(-5) + sqrt(16);");
        const emitter = new Transpiler.GmlToJsEmitter(Transpiler.createSemanticOracle());
        emitter.emit(ast);

        assert.equal(emitter.getDependencies().size, 0, "Builtin calls should not appear in dependencies");
    });

    void it("collects script symbols from nested call expressions", () => {
        const sem = makeScriptOracle(new Set(["scr_get_value", "scr_process"]));
        const ast = Parser.GMLParser.parse("result = scr_process(scr_get_value());");
        const emitter = new Transpiler.GmlToJsEmitter(sem);
        emitter.emit(ast);

        const deps = emitter.getDependencies();
        assert.equal(deps.size, 2);
        assert.ok(deps.has("gml/script/scr_get_value"));
        assert.ok(deps.has("gml/script/scr_process"));
    });

    void it("collects script symbols inside if-branches", () => {
        const sem = makeScriptOracle(new Set(["scr_on_hit"]));
        const ast = Parser.GMLParser.parse("if (hp <= 0) { scr_on_hit(); }");
        const emitter = new Transpiler.GmlToJsEmitter(sem);
        emitter.emit(ast);

        assert.ok(emitter.getDependencies().has("gml/script/scr_on_hit"));
    });
});

void describe("GmlTranspiler.transpileScript — dependencies in metadata", () => {
    void it("omits dependencies from metadata when no scripts are called", () => {
        const transpiler = new Transpiler.GmlTranspiler();
        const patch = transpiler.transpileScript({
            sourceText: "function foo() { var x = 1; return x; }",
            symbolId: "gml/script/foo"
        });

        assert.equal(patch.metadata?.dependencies, undefined);
    });

    void it("attaches dependencies when scripts are called", () => {
        const oracle = Transpiler.createSemanticOracle({ scriptNames: new Set(["scr_helper"]) });
        const transpiler = new Transpiler.GmlTranspiler({ semantic: oracle });
        const patch = transpiler.transpileScript({
            sourceText: "function foo() { scr_helper(); }",
            symbolId: "gml/script/foo"
        });

        assert.ok(Array.isArray(patch.metadata?.dependencies));
        assert.equal(patch.metadata?.dependencies?.length, 1);
        assert.ok(patch.metadata?.dependencies?.includes("gml/script/scr_helper"));
    });

    void it("deduplicates repeated script calls in the dependencies array", () => {
        const oracle = Transpiler.createSemanticOracle({ scriptNames: new Set(["scr_tick"]) });
        const transpiler = new Transpiler.GmlTranspiler({ semantic: oracle });
        const patch = transpiler.transpileScript({
            sourceText: "function update() { scr_tick(); scr_tick(); scr_tick(); }",
            symbolId: "gml/script/update"
        });

        const deps = patch.metadata?.dependencies ?? [];
        assert.equal(deps.length, 1, "Repeated calls to the same script should be deduplicated");
    });
});

void describe("GmlTranspiler.transpileEvent — dependencies in metadata", () => {
    void it("omits dependencies from metadata when no scripts are called", () => {
        const transpiler = new Transpiler.GmlTranspiler();
        const patch = transpiler.transpileEvent({
            sourceText: "x += speed;",
            symbolId: "gml/event/obj_player/step"
        });

        assert.equal(patch.metadata?.dependencies, undefined);
    });

    void it("attaches dependencies when scripts are called from an event", () => {
        const oracle = Transpiler.createSemanticOracle({ scriptNames: new Set(["scr_apply_gravity"]) });
        const transpiler = new Transpiler.GmlTranspiler({ semantic: oracle });
        const patch = transpiler.transpileEvent({
            sourceText: "scr_apply_gravity();",
            symbolId: "gml/event/obj_player/step"
        });

        assert.ok(Array.isArray(patch.metadata?.dependencies));
        assert.ok(patch.metadata?.dependencies?.includes("gml/script/scr_apply_gravity"));
    });
});

void describe("GmlTranspiler.transpileClosure — dependencies in metadata", () => {
    void it("omits dependencies from metadata when no scripts are called", () => {
        const transpiler = new Transpiler.GmlTranspiler();
        const patch = transpiler.transpileClosure({
            sourceText: "function inner(n) { return n * 2; }",
            symbolId: "gml/closure/scr_utils/inner"
        });

        assert.equal(patch.metadata?.dependencies, undefined);
    });

    void it("attaches dependencies when scripts are called from a closure", () => {
        const oracle = Transpiler.createSemanticOracle({ scriptNames: new Set(["scr_log"]) });
        const transpiler = new Transpiler.GmlTranspiler({ semantic: oracle });
        const patch = transpiler.transpileClosure({
            sourceText: "function handler(msg) { scr_log(msg); }",
            symbolId: "gml/closure/scr_utils/handler"
        });

        assert.ok(Array.isArray(patch.metadata?.dependencies));
        assert.ok(patch.metadata?.dependencies?.includes("gml/script/scr_log"));
    });
});
