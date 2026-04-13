import { strictEqual } from "node:assert";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";

import type { ProgramNode } from "../src/emitter/ast.js";
import { collectGlobalVarNames, collectLocalVariables } from "../src/emitter/local-variable-collector.js";

function parseProgram(source: string): ProgramNode {
    return Parser.GMLParser.parse(source) as unknown as ProgramNode;
}

void describe("collectLocalVariables", () => {
    void it("returns empty set for code with no var declarations", () => {
        const ast = parseProgram("x = 10; health -= 1;");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.size, 0);
    });

    void it("collects a single var-declared name", () => {
        const ast = parseProgram("var speed = 5;");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("speed"), true);
        strictEqual(locals.size, 1);
    });

    void it("collects multiple var-declared names from separate declarations", () => {
        const ast = parseProgram("var dx = 1; var dy = 2;");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("dx"), true);
        strictEqual(locals.has("dy"), true);
        strictEqual(locals.size, 2);
    });

    void it("collects multiple names from a single var declaration", () => {
        const ast = parseProgram("var a = 1, b = 2, c = 3;");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("a"), true);
        strictEqual(locals.has("b"), true);
        strictEqual(locals.has("c"), true);
        strictEqual(locals.size, 3);
    });

    void it("collects var declarations inside if blocks (GML function-scoped var)", () => {
        const ast = parseProgram('if (alive) { var msg = "hit"; }');
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("msg"), true);
    });

    void it("collects var declarations inside for loops", () => {
        const ast = parseProgram("for (var i = 0; i < 10; i++) { }");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("i"), true);
    });

    void it("does NOT collect names from nested function declarations", () => {
        const ast = parseProgram("var outer = 1;\nfunction inner() { var inner_local = 2; }");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("outer"), true, "outer should be collected");
        strictEqual(locals.has("inner_local"), false, "inner_local should not be collected");
    });

    void it("does NOT collect names from nested constructor declarations", () => {
        const ast = parseProgram("var base = 1;\nfunction MyClass() constructor { var ctor_local = 2; }");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("base"), true, "base should be collected");
        strictEqual(locals.has("ctor_local"), false, "ctor_local should not be collected");
    });

    void it("handles var declarations without initializers", () => {
        const ast = parseProgram("var uninit;");
        const locals = collectLocalVariables(ast);
        strictEqual(locals.has("uninit"), true);
    });

    void it("handles deeply nested AST nodes without recursion overflow", () => {
        const nestingDepth = 20_000;

        const root: Record<string, unknown> = {
            type: "Program",
            body: []
        };

        let cursor = root;
        for (let index = 0; index < nestingDepth; index += 1) {
            const next: Record<string, unknown> = {
                type: "BlockStatement",
                body: []
            };
            cursor.body = [next];
            cursor = next;
        }

        cursor.body = [
            {
                type: "VariableDeclaration",
                kind: "var",
                declarations: [
                    {
                        type: "VariableDeclarator",
                        id: { type: "Identifier", name: "deep_local" },
                        init: null
                    }
                ]
            }
        ];

        const locals = collectLocalVariables(root as unknown as ProgramNode);
        strictEqual(locals.has("deep_local"), true);
    });

    void it("handles a realistic event body with mixed declarations", () => {
        const source = [
            "var spd = 5;",
            "var dir = direction;",
            "x += lengthdir_x(spd, dir);",
            "y += lengthdir_y(spd, dir);"
        ].join("\n");
        const ast = parseProgram(source);
        const locals = collectLocalVariables(ast);

        strictEqual(locals.has("spd"), true, "spd is var-declared");
        strictEqual(locals.has("dir"), true, "dir is var-declared");
        strictEqual(locals.has("direction"), false, "direction is an instance field, not var-declared");
        strictEqual(locals.has("x"), false, "x is an instance field, not var-declared");
        strictEqual(locals.has("y"), false, "y is an instance field, not var-declared");
    });
});

void describe("collectGlobalVarNames", () => {
    void it("returns empty set when there are no globalvar declarations", () => {
        const ast = parseProgram("x = 10; var local = 5;");
        const globals = collectGlobalVarNames(ast);
        strictEqual(globals.size, 0);
    });

    void it("collects a single globalvar-declared name", () => {
        const ast = parseProgram("globalvar score;");
        const globals = collectGlobalVarNames(ast);
        strictEqual(globals.has("score"), true);
        strictEqual(globals.size, 1);
    });

    void it("collects multiple names from a single globalvar declaration", () => {
        const ast = parseProgram("globalvar hp, mp, xp;");
        const globals = collectGlobalVarNames(ast);
        strictEqual(globals.has("hp"), true);
        strictEqual(globals.has("mp"), true);
        strictEqual(globals.has("xp"), true);
        strictEqual(globals.size, 3);
    });

    void it("collects names from multiple globalvar declarations", () => {
        const ast = parseProgram("globalvar foo;\nglobalvar bar;");
        const globals = collectGlobalVarNames(ast);
        strictEqual(globals.has("foo"), true);
        strictEqual(globals.has("bar"), true);
        strictEqual(globals.size, 2);
    });

    void it("collects globalvar names that appear after usage (forward reference)", () => {
        // This is the core use case: `foo` is used before its globalvar declaration.
        const ast = parseProgram("foo = 1;\nglobalvar foo;");
        const globals = collectGlobalVarNames(ast);
        strictEqual(globals.has("foo"), true, "foo must be collected even though declaration comes after usage");
    });

    void it("crosses function declaration boundaries (globalvar is always global-scoped)", () => {
        const ast = parseProgram("function init() { globalvar settings; }");
        const globals = collectGlobalVarNames(ast);
        strictEqual(globals.has("settings"), true, "globalvar inside a function is still global-scoped");
    });

    void it("does not include var-declared names", () => {
        const ast = parseProgram("var local = 1;\nglobalvar g;");
        const globals = collectGlobalVarNames(ast);
        strictEqual(globals.has("local"), false, "var-declared names should not be in global set");
        strictEqual(globals.has("g"), true);
    });
});
