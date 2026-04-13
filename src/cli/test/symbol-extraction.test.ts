/**
 * Tests for AST-based symbol extraction in the transpilation coordinator.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";

import { extractReferencesFromAst, extractSymbolsFromAst } from "../src/modules/transpilation/symbol-extraction.js";

void describe("Symbol extraction from AST", () => {
    void it("should extract function declaration symbols", () => {
        const source = `
            function player_move() {
                x += 5;
            }
            
            function player_jump() {
                vspeed = -10;
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/player.gml");

        assert.ok(symbols.includes("gml_Script_player_move"), "Should extract player_move function");
        assert.ok(symbols.includes("gml_Script_player_jump"), "Should extract player_jump function");
        assert.strictEqual(symbols.length, 2, "Should extract exactly 2 symbols");
    });

    void it("should extract variable declarator function assignments", () => {
        const source = `
            var myFunc = function () {
                return 42;
            };
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/test.gml");

        assert.ok(symbols.includes("gml_Script_myFunc"), "Should extract myFunc from variable declarator");
        assert.strictEqual(symbols.length, 1, "Should extract exactly 1 symbol");
    });

    void it("should extract assignment expression function assignments", () => {
        const source = `
            myHandler = function () {
                show_debug_message("handled");
            };
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/handlers.gml");

        assert.ok(symbols.includes("gml_Script_myHandler"), "Should extract myHandler from assignment");
        assert.strictEqual(symbols.length, 1, "Should extract exactly 1 symbol");
    });

    void it("should detect object event files correctly", () => {
        const source = `
            function onCreate() {
                hp = 100;
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "objects/obj_player/Create_0.gml");

        assert.ok(
            symbols.includes("gml_Object_obj_player_Create_0"),
            "Should use object naming for object event files"
        );
    });

    void it("should handle empty files gracefully", () => {
        const source = ``;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/empty.gml");

        assert.strictEqual(symbols.length, 0, "Should return empty array for empty files");
    });

    void it("should handle files with only comments gracefully", () => {
        const source = `
            // This is a comment
            /* Multi-line
               comment */
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/comments.gml");

        assert.strictEqual(symbols.length, 0, "Should return empty array for comment-only files");
    });

    void it("should deduplicate symbols if the same name appears multiple times", () => {
        const source = `
            function test() { }
            var test = function () { };
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/duplicate.gml");

        assert.ok(symbols.includes("gml_Script_test"), "Should extract test symbol");
        assert.strictEqual(symbols.length, 1, "Should deduplicate the same symbol");
    });

    void it("should handle mixed function declarations and expressions", () => {
        const source = `
            function declared() {
                return 1;
            }
            
            var assigned = function () {
                return 2;
            };
            
            handler = function () {
                return 3;
            };
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/mixed.gml");

        assert.ok(symbols.includes("gml_Script_declared"), "Should extract declared function");
        assert.ok(symbols.includes("gml_Script_assigned"), "Should extract assigned variable");
        assert.ok(symbols.includes("gml_Script_handler"), "Should extract handler assignment");
        assert.strictEqual(symbols.length, 3, "Should extract all 3 symbols");
    });

    void it("should ignore non-function variable declarators", () => {
        const source = `
            var x = 10;
            var y = "test";
            var z = [1, 2, 3];
            
            function actual_func() {
                return 42;
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/mixed_vars.gml");

        assert.ok(symbols.includes("gml_Script_actual_func"), "Should extract actual function");
        assert.strictEqual(symbols.length, 1, "Should only extract function, not other variables");
    });

    void it("should ignore non-function assignments", () => {
        const source = `
            x = 10;
            name = "test";
            
            myFunc = function () {
                return 42;
            };
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const symbols = extractSymbolsFromAst(ast, "scripts/assignments.gml");

        assert.ok(symbols.includes("gml_Script_myFunc"), "Should extract function assignment");
        assert.strictEqual(symbols.length, 1, "Should only extract function assignment");
    });
});

void describe("Reference extraction from AST", () => {
    void it("should track direct function calls", () => {
        const source = `
            function use_helper() {
                var result = helper_function();
                return result;
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.ok(refs.includes("gml_Script_helper_function"), "Should track the called function");
    });

    void it("should not track variable names as script references", () => {
        const source = `
            function do_something() {
                var result = some_call();
                var x = 10;
                var name = "test";
                return result;
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.ok(refs.includes("gml_Script_some_call"), "Should track the called function");
        assert.ok(!refs.includes("gml_Script_result"), "Should not track local variable 'result'");
        assert.ok(!refs.includes("gml_Script_x"), "Should not track local variable 'x'");
        assert.ok(!refs.includes("gml_Script_name"), "Should not track local variable 'name'");
    });

    void it("should not create false positives from method call object names", () => {
        const source = `
            function update() {
                array_push(list, item);
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.ok(refs.includes("gml_Script_array_push"), "Should track the called function");
        assert.ok(!refs.includes("gml_Script_list"), "Should not track 'list' argument as a reference");
        assert.ok(!refs.includes("gml_Script_item"), "Should not track 'item' argument as a reference");
    });

    void it("should track nested function calls in arguments", () => {
        const source = `
            function run() {
                outer_fn(inner_fn());
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.ok(refs.includes("gml_Script_outer_fn"), "Should track outer call");
        assert.ok(refs.includes("gml_Script_inner_fn"), "Should track inner call passed as argument");
    });

    void it("should return an empty array for files with no function calls", () => {
        const source = `
            var x = 10;
            var y = 20;
            var z = x + y;
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.strictEqual(refs.length, 0, "Should return empty array when no functions are called");
    });

    void it("should deduplicate references when the same function is called multiple times", () => {
        const source = `
            function run_twice() {
                helper();
                helper();
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.deepEqual(
            refs,
            ["gml_Script_helper"],
            "Should return exactly one entry for a repeatedly called function"
        );
    });

    void it("should track function calls inside switch statement cases", () => {
        const source = `
            switch (get_state()) {
                case 0:
                    case_zero_fn();
                    break;
                default:
                    default_fn();
                    break;
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.ok(refs.includes("gml_Script_get_state"), "Should track the switch discriminant call");
        assert.ok(refs.includes("gml_Script_case_zero_fn"), "Should track function call in case body");
        assert.ok(refs.includes("gml_Script_default_fn"), "Should track function call in default case body");
    });

    void it("should track function calls in the for-loop update expression", () => {
        const source = `
            for (var i = 0; i < array_length(arr); i = step_fn(i)) {
                body_fn();
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.ok(refs.includes("gml_Script_array_length"), "Should track call in for-loop test");
        assert.ok(refs.includes("gml_Script_step_fn"), "Should track call in for-loop update");
        assert.ok(refs.includes("gml_Script_body_fn"), "Should track call in for-loop body");
    });

    void it("should track function calls in try-catch-finally blocks", () => {
        const source = `
            try {
                try_fn();
            } catch (e) {
                catch_fn();
            } finally {
                finally_fn();
            }
        `;

        const parser = new Parser.GMLParser(source, {});
        const ast = parser.parse();
        const refs = extractReferencesFromAst(ast);

        assert.ok(refs.includes("gml_Script_try_fn"), "Should track function call in try block");
        assert.ok(refs.includes("gml_Script_catch_fn"), "Should track function call in catch block");
        assert.ok(refs.includes("gml_Script_finally_fn"), "Should track function call in finally block");
    });
});
