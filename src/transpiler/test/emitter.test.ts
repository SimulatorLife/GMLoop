import assert from "node:assert/strict";
import test from "node:test";

import { Parser } from "@gmloop/parser";

import { Transpiler } from "../index.js";

type SemanticAnalyzers = ConstructorParameters<typeof Transpiler.GmlToJsEmitter>[0];

/**
 * Create a mock AST node with an unknown type for testing error handling.
 * @param type - The node type string to use in the mock
 * @returns A mock AST node
 */
function createMockUnknownNode(type: string) {
    return {
        type: type as "UnknownNodeType"
    };
}

void test("GmlToJsEmitter handles number literals in AST", () => {
    const source = "42";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("42"), "Should include the number 42");
});

void test("GmlToJsEmitter handles string literals in AST", () => {
    const source = '"hello world"';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("hello world"), "Should include the string content");
});

void test("GmlToJsEmitter handles template strings with interpolation in AST", () => {
    const source = 'var greeting = $"Hello {name}!";';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.match(result, /var greeting = `Hello \${name}!`;/, "Should emit a JavaScript template literal");
});

void test("GmlToJsEmitter preserves template string text content", () => {
    const source = String.raw`var lines = $"First line\nSecond line {count}";`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("`First line\\nSecond line "), "Should keep escaped newlines inside template text");
    assert.ok(result.includes("${count}"), "Should embed interpolated expressions with ${}");
});

void test("GmlToJsEmitter handles boolean literals in AST", () => {
    const source = "true";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("true"), "Should include the boolean true");
});

void test("GmlToJsEmitter handles identifiers in AST", () => {
    const source = "myVariable";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("myVariable"), "Should include the identifier");
});

void test("GmlToJsEmitter handles simple binary expressions in AST", () => {
    const source = "x = 1 + 2";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    // Depending on parser's literal representation, may be folded or not
    assert.ok(
        result.includes("x = ") && (result.includes("3") || (result.includes("1") && result.includes("2"))),
        "Should include assignment with expression"
    );
});

void test("GmlToJsEmitter folds string equality literals", () => {
    const source = 'isMatch = "player" == "player"';
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("isMatch = true"), "Should emit folded boolean constant for string equality");
});

void test("GmlToJsEmitter folds parser-produced string concatenation literals", () => {
    const source = 'var msg = "hello" + " world"';
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result.trim(), 'var msg = "hello world";', "Should fold string concat at compile time");
});

void test("GmlToJsEmitter folds parser-produced multi-segment string concatenation", () => {
    // Chained concat "a" + "b" + "c" is parsed as left-associative: ("a" + "b") + "c".
    // The inner pair folds to "ab", but the outer node cannot fold further because
    // its left child is a BinaryExpression (not a Literal). The result preserves
    // the folded inner concat as a string literal while the outer concat remains
    // a runtime operation.
    const source = 'var path = "sprites" + "/" + "player"';
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('"sprites/"'), "Should fold the inner concatenation to a single string");
    assert.ok(result.includes('"player"'), "Should preserve the outer operand");
});

void test("GmlToJsEmitter emits escaped literals for folded strings with control characters", () => {
    const ast = {
        type: "Program",
        body: [
            {
                type: "ExpressionStatement",
                expression: {
                    type: "AssignmentExpression",
                    operator: "=",
                    left: { type: "Identifier", name: "value" },
                    right: {
                        type: "BinaryExpression",
                        operator: "+",
                        left: { type: "Literal", value: "line\nnext" },
                        right: { type: "Literal", value: '\t"quoted"' }
                    }
                }
            }
        ]
    } as unknown as Parameters<typeof Transpiler.emitJavaScript>[0];
    const result = Transpiler.emitJavaScript(ast);

    assert.equal(result, String.raw`value = "line\nnext\t\"quoted\"";`);
});

void test("GmlToJsEmitter passes through GML div operator unchanged (div is special-cased in the emitter)", () => {
    assert.equal(Transpiler.mapBinaryOperator("div"), "div");
});

void test("GmlToJsEmitter lowers GML div operator to Math.trunc integer division", () => {
    // `div` must lower to Math.trunc(a / b), not plain `/`.
    // Plain division produces floats; Math.trunc truncates toward zero like GML semantics.
    const source = "result = a div b";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.match(result, /Math\.trunc\(a \/ b\)/, "Should emit Math.trunc(a / b) for the div operator");
});

void test("GmlToJsEmitter maps GML mod operator to JavaScript modulo", () => {
    assert.equal(Transpiler.mapBinaryOperator("mod"), "%");
});

void test("GmlToJsEmitter maps GML and operator to JavaScript &&", () => {
    assert.equal(Transpiler.mapBinaryOperator("and"), "&&");
});

void test("GmlToJsEmitter maps GML or operator to JavaScript ||", () => {
    assert.equal(Transpiler.mapBinaryOperator("or"), "||");
});

void test("GmlToJsEmitter maps GML not operator to JavaScript !", () => {
    assert.equal(Transpiler.mapUnaryOperator("not"), "!"); // GML does not support the operator 'not'; this is included to automatic fixing
});

void test("GmlToJsEmitter maps == to === for strict equality", () => {
    assert.equal(Transpiler.mapBinaryOperator("=="), "===");
});

void test("GmlToJsEmitter maps != to !== for strict inequality", () => {
    assert.equal(Transpiler.mapBinaryOperator("!="), "!==");
});

void test("GmlToJsEmitter maps bitwise AND operator", () => {
    assert.equal(Transpiler.mapBinaryOperator("&"), "&");
});

void test("GmlToJsEmitter maps bitwise OR operator", () => {
    assert.equal(Transpiler.mapBinaryOperator("|"), "|");
});

void test("GmlToJsEmitter maps bitwise XOR operator", () => {
    assert.equal(Transpiler.mapBinaryOperator("xor"), "^");
});

void test("GmlToJsEmitter maps left shift operator", () => {
    assert.equal(Transpiler.mapBinaryOperator("<<"), "<<");
});

void test("GmlToJsEmitter maps right shift operator", () => {
    assert.equal(Transpiler.mapBinaryOperator(">>"), ">>");
});

void test("GmlToJsEmitter preserves standard JavaScript operators", () => {
    assert.equal(Transpiler.mapBinaryOperator("+"), "+");
    assert.equal(Transpiler.mapBinaryOperator("-"), "-");
    assert.equal(Transpiler.mapBinaryOperator("*"), "*");
    assert.equal(Transpiler.mapBinaryOperator("/"), "/");
});

void test("Transpiler.emitJavaScript exports a function", () => {
    assert.equal(typeof Transpiler.emitJavaScript, "function");
});

void test("Transpiler.emitJavaScript handles empty AST gracefully", () => {
    const result = Transpiler.emitJavaScript(null);
    assert.equal(result, "");
});

void test("Transpiler.emitJavaScript returns empty string for unsupported node types", () => {
    const ast = {
        type: "UnsupportedNode"
    } as unknown as Parameters<typeof Transpiler.emitJavaScript>[0];
    const result = Transpiler.emitJavaScript(ast);
    assert.equal(result, "");
});

void test("Transpiler.emitJavaScript handles array access (MemberIndexExpression)", () => {
    const source = "x = arr[0]";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arr[0]"), "Should emit array access syntax");
    assert.ok(result.includes("="), "Should include assignment");
});

void test("Transpiler.emitJavaScript handles multi-dimensional array access", () => {
    const source = "x = matrix[i][j]";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("matrix[i][j]"), "Should emit nested array access");
});

void test("Transpiler.emitJavaScript handles property access (MemberDotExpression)", () => {
    const source = "x = obj.prop";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("obj.prop"), "Should emit property access syntax");
});

void test("Transpiler.emitJavaScript handles function calls (CallExpression)", () => {
    const source = "result = func()";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("func()"), "Should emit function call syntax");
});

void test("Transpiler.emitJavaScript handles function calls with arguments", () => {
    const source = "result = func(1, 2, 3)";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(
        result.includes("func(") && result.includes("1") && result.includes("2"),
        "Should emit function call with arguments"
    );
});

void test("GmlToJsEmitter visits builtin call arguments only once", () => {
    const defaultOracle = Transpiler.createSemanticOracle();
    const sem: SemanticAnalyzers = Object.assign(Object.create(defaultOracle), {
        callTargetKind() {
            return "builtin" as const;
        }
    });
    const emitter = new Transpiler.GmlToJsEmitter(sem);
    const emitterInternals = emitter as unknown as {
        visit(node: Parameters<typeof emitter.emit>[0]): string;
    };
    const originalVisit = emitterInternals.visit.bind(emitter);
    let visitedSideEffectArgument = 0;

    emitterInternals.visit = ((node: Parameters<typeof emitter.emit>[0]) => {
        if (
            node &&
            typeof node === "object" &&
            "type" in node &&
            (node as { type: string }).type === "SideEffectArgument"
        ) {
            visitedSideEffectArgument += 1;
            return "value";
        }
        return originalVisit(node);
    }) as typeof emitterInternals.visit;

    const result = emitter.emit({
        type: "CallExpression",
        object: { type: "Identifier", name: "abs" },
        arguments: [{ type: "SideEffectArgument" }]
    } as unknown as Parameters<typeof emitter.emit>[0]);

    assert.equal(result, "abs(value)");
    assert.equal(visitedSideEffectArgument, 1, "builtin arguments should only be emitted once");
});

void test("GmlToJsEmitter routes script calls through the wrapper helper", () => {
    const source = "result = scr_attack(target)";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const defaultOracle = Transpiler.createSemanticOracle();
    const sem: SemanticAnalyzers = Object.assign(Object.create(defaultOracle), {
        callTargetKind(node) {
            if (node.object?.type === "Identifier" && node.object.name === "scr_attack") {
                return "script";
            }
            return "unknown";
        },
        callTargetSymbol(node) {
            if (node.object?.type === "Identifier" && node.object.name === "scr_attack") {
                return "gml/script/scr_attack";
            }
            return null;
        }
    });
    const emitter = new Transpiler.GmlToJsEmitter(sem);
    const result = emitter.emit(ast);

    assert.ok(
        result.includes('__call_script("gml/script/scr_attack", self, other, [target])'),
        "Should call scripts through __call_script helper"
    );
});

void test("GmlToJsEmitter does not emit script callees when symbol metadata is available", () => {
    const source = "obj.scr_attack(target)";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const defaultOracle = Transpiler.createSemanticOracle();
    const sem: SemanticAnalyzers = Object.assign(Object.create(defaultOracle), {
        callTargetKind() {
            return "script";
        },
        callTargetSymbol() {
            return "gml/script/scr_attack";
        },
        nameOfIdent(node) {
            if (node.name === "scr_attack") {
                throw new Error("Script callee should not be resolved when symbol metadata exists");
            }
            return defaultOracle.nameOfIdent(node);
        }
    });
    const emitter = new Transpiler.GmlToJsEmitter(sem);
    const result = emitter.emit(ast);

    assert.ok(result.includes('__call_script("gml/script/scr_attack", self, other, [target])'));
});

void test("GmlToJsEmitter allows overriding the script call helper name", () => {
    const source = "scr_attack()";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const defaultOracle = Transpiler.createSemanticOracle();
    const sem: SemanticAnalyzers = Object.assign(Object.create(defaultOracle), {
        callTargetKind() {
            return "script";
        },
        callTargetSymbol() {
            return "gml/script/scr_attack";
        }
    });
    const emitter = new Transpiler.GmlToJsEmitter(sem, {
        callScriptIdent: "__runtime_call"
    });
    const result = emitter.emit(ast);

    assert.ok(
        result.includes('__runtime_call("gml/script/scr_attack", self, other,'),
        "Should respect the configured script call helper"
    );
    assert.ok(result.includes("[]"), "Should pass an empty argument array");
});

void test("Transpiler.emitJavaScript qualifies global identifiers using the global struct", () => {
    const source = "globalvar foo; foo = 1;";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(
        result.includes('if (!Object.prototype.hasOwnProperty.call(global, "foo"))'),
        "Should guard access on the global object"
    );

    assert.ok(result.includes("global.foo = undefined;"), "Should register global variables on global");

    assert.ok(result.includes("global.foo = 1"), "Should qualify global identifier references");
});

void test("Transpiler.emitJavaScript does not qualify member dot properties as globals", () => {
    const source = "globalvar foo; obj.foo = 1;";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("obj.foo = 1"), "Should emit raw member properties");
    assert.ok(!result.includes("obj.global.foo"), "Should not qualify member properties as globals");
});

void test("GmlToJsEmitter allows overriding the globals identifier", () => {
    const source = "globalvar foo; foo = 1;";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const emitter = new Transpiler.GmlToJsEmitter(Transpiler.createSemanticOracle(), {
        globalsIdent: "__globals"
    });

    const result = emitter.emit(ast);

    assert.ok(result.includes("__globals.foo = 1"), "Should respect the configured globals identifier");
});

void test("GmlToJsEmitter applies the globals identifier for globalvar initialization", () => {
    const source = "globalvar foo;";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const emitter = new Transpiler.GmlToJsEmitter(Transpiler.createSemanticOracle(), {
        globalsIdent: "__globals"
    });

    const result = emitter.emit(ast);

    assert.ok(
        result.includes('Object.prototype.hasOwnProperty.call(__globals, "foo")'),
        "Should guard against reinitialising globals on the configured globals object"
    );
    assert.ok(result.includes("__globals.foo = undefined;"), "Should initialise globals on the configured object");
});

void test("Transpiler.emitJavaScript accepts emitter options", () => {
    const source = "globalvar foo; foo = 1;";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast, Transpiler.createSemanticOracle(), {
        globalsIdent: "__globals"
    });

    assert.ok(result.includes("__globals.foo = 1"), "Should respect emitter options in emitJavaScript");
});

// Control flow tests
void test("Transpiler.emitJavaScript handles if statements", () => {
    const source = "if (x > 10) { y = 5; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("if"), "Should include if keyword");
    assert.ok(result.includes("x"), "Should include condition variable");
    assert.ok(result.includes("y = 5"), "Should include consequent body");
});

void test("Transpiler.emitJavaScript handles if-else statements", () => {
    const source = "if (x > 10) { y = 5; } else { y = 0; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("if"), "Should include if keyword");
    assert.ok(result.includes("else"), "Should include else keyword");
    assert.ok(result.includes("y = 5"), "Should include then branch");
    assert.ok(result.includes("y = 0"), "Should include else branch");
});

void test("Transpiler.emitJavaScript handles else-if chains", () => {
    const source = "if (x > 10) { y = 1; } else if (x > 5) { y = 2; } else { y = 3; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("if"), "Should include if keyword");
    assert.ok(result.includes("else"), "Should include else keyword");
    assert.ok(result.includes("y = 1"), "Should include first branch");
    assert.ok(result.includes("y = 2"), "Should include second branch");
    assert.ok(result.includes("y = 3"), "Should include third branch");
});

void test("Transpiler.emitJavaScript handles if without braces", () => {
    const source = "if (x > 10) y = 5";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("if"), "Should include if keyword");
    assert.ok(result.includes("y = 5"), "Should include statement");
    assert.ok(result.includes("{") && result.includes("}"), "Should add braces");
});

void test("Transpiler.emitJavaScript handles for loops", () => {
    const source = "for (var i = 0; i < 10; i += 1) { x += i; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should include for keyword");
    assert.ok(result.includes("var i = 0"), "Should include initialization");
    assert.ok(result.includes("i < 10"), "Should include test condition");
    assert.ok(result.includes("i += 1"), "Should include update");
    assert.ok(result.includes("x += i"), "Should include body");
});

void test("Transpiler.emitJavaScript handles for loop without var keyword", () => {
    const source = "for (i = 0; i < 10; i += 1) { x += i; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should include for keyword");
    assert.ok(result.includes("i = 0"), "Should include initialization");
    assert.ok(result.includes("i < 10"), "Should include test condition");
});

void test("Transpiler.emitJavaScript handles while loops", () => {
    const source = "while (x > 0) { x -= 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("while"), "Should include while keyword");
    assert.ok(result.includes("x > 0"), "Should include test condition");
    assert.ok(result.includes("x -= 1"), "Should include body");
});

void test("Transpiler.emitJavaScript handles while loop without braces", () => {
    const source = "while (x > 0) x -= 1";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("while"), "Should include while keyword");
    assert.ok(result.includes("x -= 1"), "Should include statement");
    assert.ok(result.includes("{") && result.includes("}"), "Should add braces");
});

void test("Transpiler.emitJavaScript handles with statements with block bodies", () => {
    const source = "with (obj_enemy) { hp -= 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("__resolve_with_targets"), "Should resolve with targets through helper");
    assert.ok(result.includes("const __with_prev_self = self"), "Should capture previous self binding");
    assert.ok(result.includes("self = __with_self"), "Should assign new self value for each target");
    assert.ok(result.includes("other = __with_prev_self"), "Should expose previous self as other");
    assert.ok(result.includes("hp -= 1"), "Should emit loop body");
});

void test("Transpiler.emitJavaScript wraps with statements without braces", () => {
    const source = "with (obj_enemy) hp -= 1";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("with_prev_self"), "Should manage scope bindings");
    assert.ok(result.includes("        {\n        hp -= 1;\n        }"), "Should wrap single statements in a block");
});

void test("GmlToJsEmitter allows overriding the with-target resolver helper", () => {
    const source = "with (obj_enemy) hp -= 1";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const emitter = new Transpiler.GmlToJsEmitter(Transpiler.createSemanticOracle(), {
        resolveWithTargetsIdent: "__custom_resolve_with"
    });
    const result = emitter.emit(ast);

    assert.ok(
        result.includes('typeof __custom_resolve_with === "function"'),
        "Should reference the configured resolver helper"
    );

    assert.ok(result.includes("__custom_resolve_with("), "Should invoke the configured resolver helper when available");

    assert.ok(
        !result.includes("globalThis.__resolve_with_targets"),
        "Should avoid emitting the default resolver when overridden"
    );
});

void test("Transpiler.emitJavaScript handles variable declarations", () => {
    const source = "var x = 10";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("var x = 10"), "Should include var declaration");
});

void test("Transpiler.emitJavaScript handles multiple variable declarations", () => {
    const source = "var x = 10, y = 20, z = 30";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("var"), "Should include var keyword");
    assert.ok(result.includes("x = 10"), "Should include first declaration");
    assert.ok(result.includes("y = 20"), "Should include second declaration");
    assert.ok(result.includes("z = 30"), "Should include third declaration");
});

void test("Transpiler.emitJavaScript handles variable declaration without initialization", () => {
    const source = "var x";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("var x"), "Should include variable name");
});

void test("Transpiler.emitJavaScript lowers globalvar declarations into guarded globals", () => {
    const source = "globalvar foo, bar;";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.match(
        result,
        /Object\.prototype\.hasOwnProperty\.call\(global, "foo"\)/,
        "Should guard against reinitialising foo"
    );
    assert.match(result, /global\.foo = undefined;/, "Should initialise foo on the global object");
    assert.match(
        result,
        /Object\.prototype\.hasOwnProperty\.call\(global, "bar"\)/,
        "Should guard against reinitialising bar"
    );
    assert.match(result, /global\.bar = undefined;/, "Should initialise bar on the global object");
});

void test("Transpiler.emitJavaScript preserves subsequent statements after globalvar", () => {
    const source = "globalvar foo;\nfoo = 5;";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("foo = 5"), "Should keep assignments following the globalvar declaration");
});

void test("Transpiler.emitJavaScript qualifies globalvar forward references as globals", () => {
    // GML allows using a globalvar-declared name before the declaration appears
    // in source. The emitter must pre-collect all globalvar names so that forward
    // references are emitted as `global.<name>` rather than bare identifiers.
    const source = "foo = 1;\nglobalvar foo;";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes("global.foo"), "Forward-referenced globalvar name should be prefixed with global.");
    assert.ok(!result.startsWith("foo ="), "First statement should NOT emit foo as a bare identifier");
});

void test("Transpiler.emitJavaScript handles nested control flow", () => {
    const source = "if (x > 0) { for (var i = 0; i < x; i += 1) { y += i; } }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("if"), "Should include if keyword");
    assert.ok(result.includes("for"), "Should include for keyword");
    assert.ok(result.includes("y += i"), "Should include nested body");
});

void test("Transpiler.emitJavaScript handles parenthesized expressions in assignments", () => {
    const source = "result = (x + y) * z";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("(x + y)"), "Should preserve parenthesization");
    assert.ok(result.includes("* z"), "Should include multiplication");
});

void test("Transpiler.emitJavaScript handles return statements with value", () => {
    const source = "return x + y";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("return"), "Should include return keyword");
    assert.ok(result.includes("x + y"), "Should include return value");
});

void test("Transpiler.emitJavaScript handles return statement without value", () => {
    const source = "return";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.equal(result.trim(), "return;", "Should emit return statement");
});

void test("Transpiler.emitJavaScript handles break statements", () => {
    const source = "break";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.equal(result.trim(), "break;", "Should emit break statement");
});

void test("Transpiler.emitJavaScript handles continue statements", () => {
    const source = "continue";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.equal(result.trim(), "continue;", "Should emit continue statement");
});

void test("Transpiler.emitJavaScript handles postfix increment statements", () => {
    const source = "i++";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.equal(result.trim(), "i++;", "Should emit postfix increment");
});

void test("Transpiler.emitJavaScript handles prefix increment expressions", () => {
    const source = "var x = ++i";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("var x = ++i"), "Should emit prefix increment");
});

void test("Transpiler.emitJavaScript handles postfix decrement on member access", () => {
    const source = "arr[i]--";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arr[i]--"), "Should emit member decrement");
});

void test("Transpiler.emitJavaScript lowers exit statements to return", () => {
    const source = "exit";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.equal(result.trim(), "return;", "Should emit return for exit");
});

void test("Transpiler.emitJavaScript handles do-until loops", () => {
    const source = "do { x += 1; } until (x > 10)";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("do"), "Should include do keyword");
    assert.ok(result.includes("while"), "Should convert until to while");
    assert.ok(result.includes("!"), "Should negate the condition");
    assert.ok(result.includes("x += 1"), "Should include body");
});

void test("Transpiler.emitJavaScript handles switch statements", () => {
    const source = "switch (x) { case 1: y = 1; break; case 2: y = 2; break; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("switch"), "Should include switch keyword");
    assert.ok(result.includes("case 1"), "Should include first case");
    assert.ok(result.includes("case 2"), "Should include second case");
    assert.ok(result.includes("break"), "Should include break statements");
});

void test("Transpiler.emitJavaScript handles switch with default case", () => {
    const source = "switch (x) { case 1: y = 1; break; default: y = 0; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("switch"), "Should include switch keyword");
    assert.ok(result.includes("case 1"), "Should include case");
    assert.ok(result.includes("default"), "Should include default case");
});

void test("Transpiler.emitJavaScript handles for loop with break", () => {
    const source = "for (var i = 0; i < 10; i += 1) { if (i == 5) break; }";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should include for keyword");
    assert.ok(result.includes("if"), "Should include if keyword");
    assert.ok(result.includes("break"), "Should include break");
});

void test("Transpiler.emitJavaScript handles while loop with continue", () => {
    const source = "while (x > 0) { if (x % 2 == 0) continue; x -= 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("while"), "Should include while keyword");
    assert.ok(result.includes("continue"), "Should include continue");
});

// Repeat statement tests
void test("Transpiler.emitJavaScript handles repeat statements", () => {
    const source = "repeat (5) { x += 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should convert to for loop");
    assert.ok(result.includes("__repeat_count"), "Should use __repeat_count variable");
    assert.ok(result.includes("5"), "Should include repeat count");
    assert.ok(result.includes("x += 1"), "Should include body");
});

void test("Transpiler.emitJavaScript handles repeat with variable count", () => {
    const source = "repeat (n) { total += 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should convert to for loop");
    assert.ok(result.includes("n"), "Should include variable count");
    assert.ok(result.includes("total += 1"), "Should include body");
});

void test("Transpiler.emitJavaScript handles repeat with expression count", () => {
    const source = "repeat (x + y) { z += 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should convert to for loop");
    assert.ok(result.includes("x") && result.includes("y"), "Should include expression");
});

void test("Transpiler.emitJavaScript handles repeat without braces", () => {
    const source = "repeat (3) x += 1";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should convert to for loop");
    assert.ok(result.includes("{") && result.includes("}"), "Should add braces");
});

void test("Transpiler.emitJavaScript handles nested repeat statements", () => {
    const source = "repeat (x) { repeat (y) { z += 1; } }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should include for loops");
    assert.ok(result.includes("x"), "Should include outer count");
    assert.ok(result.includes("y"), "Should include inner count");
});

void test("Transpiler.emitJavaScript handles repeat with break", () => {
    const source = "repeat (10) { if (x > 5) break; x += 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should convert to for loop");
    assert.ok(result.includes("break"), "Should include break");
});

void test("Transpiler.emitJavaScript handles repeat with continue", () => {
    const source = "repeat (10) { if (x % 2 == 0) continue; x += 1; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("for"), "Should convert to for loop");
    assert.ok(result.includes("continue"), "Should include continue");
});

// Array and struct literal tests
void test("Transpiler.emitJavaScript handles empty array literals", () => {
    const source = "x = []";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("x = []"), "Should emit empty array literal");
});

void test("Transpiler.emitJavaScript handles array literals with elements", () => {
    const source = "x = [1, 2, 3]";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("[1, 2, 3]"), "Should emit array literal");
});

void test("Transpiler.emitJavaScript handles array literals with expressions", () => {
    const source = "x = [a + b, c * d, 5]";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("[") && result.includes("]"), "Should emit array literal");
    assert.ok(result.includes("a"), "Should include expression");
});

void test("Transpiler.emitJavaScript handles nested array literals", () => {
    const source = "x = [[1, 2], [3, 4]]";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("[[") && result.includes("]]"), "Should emit nested arrays");
});

void test("Transpiler.emitJavaScript handles empty struct literals", () => {
    const source = "x = {}";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("{}"), "Should emit empty struct literal");
});

void test("Transpiler.emitJavaScript handles struct literals with properties", () => {
    const source = "x = {a: 1, b: 2}";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("a: 1"), "Should include first property");
    assert.ok(result.includes("b: 2"), "Should include second property");
});

void test("Transpiler.emitJavaScript handles struct literals with string keys", () => {
    const source = 'x = {name: "player", hp: 100}';
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("name:"), "Should include name property");
    assert.ok(result.includes("hp:"), "Should include hp property");
});

void test("Transpiler.emitJavaScript quotes struct keys that are not identifiers", () => {
    const source = 'x = {"player-name": 1, "level 1": 2}';
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes('"player-name": 1'), "Should preserve hyphenated keys with quotes");
    assert.ok(result.includes('"level 1": 2'), "Should quote keys that include whitespace");
});

void test("Transpiler.emitJavaScript escapes quotes inside struct keys", () => {
    const source = String.raw`x = {"player\"name": 3}`;
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.ok(result.includes(String.raw`"player\"name": 3`), "Should escape embedded quotes in key names");
});

void test("Transpiler.emitJavaScript handles struct literals with expression values", () => {
    const source = "x = {total: a + b, half: n / 2}";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("total:"), "Should include total property");
    assert.ok(result.includes("half:"), "Should include half property");
});

void test("Transpiler.emitJavaScript handles nested struct literals", () => {
    const source = "x = {outer: {inner: 42}}";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("outer:") && result.includes("inner:"), "Should emit nested structs");
});

void test("Transpiler.emitJavaScript handles structs with array properties", () => {
    const source = "x = {items: [1, 2, 3], name: val}";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("items:"), "Should include items property");
    assert.ok(result.includes("[1, 2, 3]"), "Should include array literal");
});

void test("Transpiler.emitJavaScript handles arrays with struct elements", () => {
    const source = "x = [{a: 1}, {b: 2}]";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("a: 1"), "Should include first struct");
    assert.ok(result.includes("b: 2"), "Should include second struct");
});

// Enum declaration tests
void test("Transpiler.emitJavaScript handles enum declarations with implicit values", () => {
    const source = `enum Colors { red, green = 5, blue }`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast).trim();

    const expected = [
        "const Colors = (() => {",
        "    const __enum = {};",
        "    let __value = -1;",
        "    __value += 1;",
        "    __enum.red = __value;",
        "    __value = 5;",
        "    __enum.green = __value;",
        "    __value += 1;",
        "    __enum.blue = __value;",
        "    return __enum;",
        "})();"
    ].join("\n");

    assert.equal(result, expected);
});

void test("Transpiler.emitJavaScript handles enum declarations with expressions", () => {
    const source = `enum Foo { bar = 1 + 2, baz, qux = "hi" }`;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    // Depending on parser's literal representation, may be folded or not
    assert.ok(
        result.includes("__value = ") && (result.includes("3") || (result.includes("1") && result.includes("2"))),
        "Should emit initializer expression"
    );
    assert.ok(result.includes("__value += 1;\n    __enum.baz = __value;"), "Should increment implicit enum value");
    assert.ok(result.includes('__value = "hi";'), "Should emit string initializer verbatim");
});

// Ternary expression tests
void test("Transpiler.emitJavaScript handles simple ternary expressions", () => {
    const source = "x = a > b ? a : b";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("?"), "Should include ? operator");
    assert.ok(result.includes(":"), "Should include : operator");
    assert.ok(result.includes("a > b"), "Should include test condition");
});

void test("Transpiler.emitJavaScript handles ternary with parenthesized test", () => {
    const source = "x = (a > b) ? a : b";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("?"), "Should include ternary operator");
    assert.ok(result.includes("a"), "Should include consequent");
    assert.ok(result.includes("b"), "Should include alternate");
});

void test("Transpiler.emitJavaScript handles nested ternary expressions", () => {
    const source = "x = a > b ? (c > d ? c : d) : b";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("?"), "Should include ternary operators");
});

void test("Transpiler.emitJavaScript handles ternary with complex expressions", () => {
    const source = "result = (x + y) > 10 ? x * 2 : y / 2";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("?"), "Should include ternary operator");
    assert.ok(result.includes("x + y"), "Should include test expression");
    assert.ok(result.includes("x * 2"), "Should include consequent");
    assert.ok(result.includes("y / 2"), "Should include alternate");
});

void test("Transpiler.emitJavaScript handles ternary with function calls", () => {
    const source = "x = check() ? getValue() : getDefault()";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("check()"), "Should include test function");
    assert.ok(result.includes("getValue()"), "Should include consequent function");
    assert.ok(result.includes("getDefault()"), "Should include alternate function");
});

// Parenthesized expression tests
void test("Transpiler.emitJavaScript handles simple parenthesized expression", () => {
    const source = "x = (5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("(5)"), "Should preserve parentheses");
});

void test("Transpiler.emitJavaScript handles parenthesized binary expression", () => {
    const source = "x = (a + b)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("(a + b)"), "Should wrap binary expression in parentheses");
});

void test("Transpiler.emitJavaScript handles nested parenthesized expressions", () => {
    const source = "x = ((a + b))";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("((a + b))"), "Should preserve nested parentheses");
});

void test("Transpiler.emitJavaScript handles parenthesized expression in arithmetic", () => {
    const source = "x = (a + b) * c";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("(a + b)"), "Should preserve parentheses for precedence");
    assert.ok(result.includes("* c"), "Should include multiplication");
});

void test("Transpiler.emitJavaScript handles parenthesized function call", () => {
    const source = "x = (myFunc())";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("(myFunc())"), "Should wrap function call in parentheses");
});

// Error handling tests
void test("Transpiler.emitJavaScript handles throw statements with string", () => {
    const source = 'throw "Error message"';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("throw"), "Should include throw keyword");
    assert.ok(result.includes("Error message"), "Should include error message");
});

void test("Transpiler.emitJavaScript handles throw statements with expression", () => {
    const source = "throw new_error(code)";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("throw"), "Should include throw keyword");
    assert.ok(result.includes("new_error"), "Should include expression");
});

void test("Transpiler.emitJavaScript handles try-catch statements", () => {
    const source = "try { risky(); } catch (e) { handle(e); }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("try"), "Should include try keyword");
    assert.ok(result.includes("catch"), "Should include catch keyword");
    assert.ok(result.includes("risky()"), "Should include try block");
    assert.ok(result.includes("handle(e)"), "Should include catch block");
});

void test("Transpiler.emitJavaScript handles try-catch without parameter", () => {
    const source = "try { code(); } catch { recover(); }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("try"), "Should include try keyword");
    assert.ok(result.includes("catch"), "Should include catch keyword");
    assert.ok(result.includes("err") || result.includes("("), "Should provide default parameter");
});

void test("Transpiler.emitJavaScript handles try-finally statements", () => {
    const source = "try { code(); } finally { cleanup(); }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("try"), "Should include try keyword");
    assert.ok(result.includes("finally"), "Should include finally keyword");
    assert.ok(result.includes("cleanup()"), "Should include finally block");
});

void test("Transpiler.emitJavaScript handles try-catch-finally statements", () => {
    const source = "try { risky(); } catch (e) { handle(e); } finally { cleanup(); }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("try"), "Should include try keyword");
    assert.ok(result.includes("catch"), "Should include catch keyword");
    assert.ok(result.includes("finally"), "Should include finally keyword");
    assert.ok(result.includes("risky()"), "Should include try block");
    assert.ok(result.includes("handle(e)"), "Should include catch block");
    assert.ok(result.includes("cleanup()"), "Should include finally block");
});

void test("Transpiler.emitJavaScript handles nested try-catch blocks", () => {
    const source = "try { try { inner(); } catch (e) { log(e); } } catch (e) { outer(e); }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("try"), "Should include try keywords");
    assert.ok(result.includes("inner()"), "Should include inner try block");
    assert.ok(result.includes("outer(e)"), "Should include outer catch block");
});

void test("Transpiler.emitJavaScript handles function declarations without parameters", () => {
    const source = "function myFunction() { return 42; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("function myFunction"), "Should include function keyword and name");
    assert.ok(result.includes("()"), "Should include empty parameter list");
    assert.ok(result.includes("return 42"), "Should include function body");
});

void test("Transpiler.emitJavaScript handles function declarations with parameters", () => {
    const source = "function add(a, b) { return a + b; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("function add"), "Should include function keyword and name");
    assert.ok(result.includes("(a, b)"), "Should include parameters");
    assert.ok(result.includes("return"), "Should include return statement");
    assert.ok(result.includes("a + b") || result.includes("(a + b)"), "Should include addition operation");
});

void test("Transpiler.emitJavaScript handles function declarations with multiple statements", () => {
    const source = "function process(x) { var y = x * 2; return y; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("function process"), "Should include function name");
    assert.ok(result.includes("(x)"), "Should include parameter");
    assert.ok(result.includes("var y"), "Should include variable declaration");
    assert.ok(result.includes("return y"), "Should include return statement");
});

void test("Transpiler.emitJavaScript handles function declarations with empty body", () => {
    const source = "function emptyFunc() {}";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("function emptyFunc"), "Should include function name");
    assert.ok(result.includes("()"), "Should include empty parameter list");
    assert.ok(result.includes("{") && result.includes("}"), "Should include braces for body");
});

void test("Transpiler.emitJavaScript handles function declarations with control flow", () => {
    const source = "function checkValue(val) { if (val > 0) { return true; } return false; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("function checkValue"), "Should include function name");
    assert.ok(result.includes("if"), "Should include if statement");
    assert.ok(result.includes("return true"), "Should include conditional return");
    assert.ok(result.includes("return false"), "Should include default return");
});

void test("Transpiler.emitJavaScript handles nested function declarations", () => {
    const source = "function outer() { function inner() { return 1; } return inner(); }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("function outer"), "Should include outer function");
    assert.ok(result.includes("function inner"), "Should include inner function");
    assert.ok(result.includes("return inner()"), "Should include inner function call");
});

void test("Transpiler.emitJavaScript handles function with many parameters", () => {
    const source = "function multiParam(a, b, c, d, e) { return a + b + c + d + e; }";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("function multiParam"), "Should include function name");
    assert.ok(result.includes("a, b, c, d, e"), "Should include all parameters");
    assert.ok(result.includes("return"), "Should include return statement");
});

void test("Transpiler.emitJavaScript leaves point_distance as a runtime builtin call", () => {
    const source = "dist = point_distance(0, 0, 10, 10)";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("point_distance(0, 0, 10, 10)"), "Should call point_distance directly");
});

void test("Transpiler.emitJavaScript leaves abs as a runtime builtin call", () => {
    const source = "val = abs(-10)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("abs(-10)"), "Should call abs directly");
});

void test("Transpiler.emitJavaScript leaves min as a runtime builtin call", () => {
    const source = "val = min(1, 2, 3)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("min(1, 2, 3)"), "Should call min directly");
});

void test("Transpiler.emitJavaScript leaves max as a runtime builtin call", () => {
    const source = "val = max(1, 2, 3)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("max(1, 2, 3)"), "Should call max directly");
});

void test("Transpiler.emitJavaScript leaves sqrt as a runtime builtin call", () => {
    const source = "val = sqrt(25)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("sqrt(25)"), "Should call sqrt directly");
});

void test("Transpiler.emitJavaScript leaves sqr as a runtime builtin call", () => {
    const source = "val = sqr(5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("sqr(5)"), "Should call sqr directly");
});

void test("Transpiler.emitJavaScript leaves power as a runtime builtin call", () => {
    const source = "val = power(2, 8)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("power(2, 8)"), "Should call power directly");
});

void test("Transpiler.emitJavaScript leaves exp as a runtime builtin call", () => {
    const source = "val = exp(2)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("exp(2)"), "Should call exp directly");
});

void test("Transpiler.emitJavaScript leaves ln as a runtime builtin call", () => {
    const source = "val = ln(10)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("ln(10)"), "Should call ln directly");
});

void test("Transpiler.emitJavaScript leaves log2 as a runtime builtin call", () => {
    const source = "val = log2(8)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("log2(8)"), "Should call log2 directly");
});

void test("Transpiler.emitJavaScript leaves log10 as a runtime builtin call", () => {
    const source = "val = log10(100)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("log10(100)"), "Should call log10 directly");
});

void test("Transpiler.emitJavaScript leaves arcsin as a runtime builtin call", () => {
    const source = "val = arcsin(0.5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arcsin(0.5)"), "Should call arcsin directly");
});

void test("Transpiler.emitJavaScript leaves arccos as a runtime builtin call", () => {
    const source = "val = arccos(0.5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arccos(0.5)"), "Should call arccos directly");
});

void test("Transpiler.emitJavaScript leaves arctan as a runtime builtin call", () => {
    const source = "val = arctan(1)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arctan(1)"), "Should call arctan directly");
});

void test("Transpiler.emitJavaScript leaves arctan2 as a runtime builtin call", () => {
    const source = "val = arctan2(1, 1)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arctan2(1, 1)"), "Should call arctan2 directly");
});

void test("Transpiler.emitJavaScript leaves degtorad as a runtime builtin call", () => {
    const source = "val = degtorad(180)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("degtorad(180)"), "Should call degtorad directly");
});

void test("Transpiler.emitJavaScript leaves radtodeg as a runtime builtin call", () => {
    const source = "val = radtodeg(3.14159)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("radtodeg(3.14159)"), "Should call radtodeg directly");
});

void test("Transpiler.emitJavaScript leaves sign as a runtime builtin call", () => {
    const source = "val = sign(-5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("sign(-5)"), "Should call sign directly");
});

void test("Transpiler.emitJavaScript leaves clamp as a runtime builtin call", () => {
    const source = "val = clamp(15, 0, 10)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("clamp(15, 0, 10)"), "Should call clamp directly");
});

void test("Transpiler.emitJavaScript handles power with wrong argument count gracefully", () => {
    const source = "val = power(2)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("power(2)"), "Should fall back to power function call when arg count is wrong");
});

void test("Transpiler.emitJavaScript handles arctan2 with wrong argument count gracefully", () => {
    const source = "val = arctan2(1)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arctan2(1)"), "Should fall back to arctan2 function call when arg count is wrong");
});

void test("Transpiler.emitJavaScript handles degtorad with wrong argument count gracefully", () => {
    const source = "val = degtorad(90, 180)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(
        result.includes("degtorad(90, 180)"),
        "Should fall back to degtorad function call when arg count is wrong"
    );
});

// String function tests
void test("Transpiler.emitJavaScript leaves string_length as a runtime builtin call", () => {
    const source = 'len = string_length("hello")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_length("hello")'), "Should call string_length directly");
});

void test("Transpiler.emitJavaScript leaves string_char_at as a runtime builtin call", () => {
    const source = 'ch = string_char_at("abc", 2)';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_char_at("abc", 2)'), "Should call string_char_at directly");
});

void test("Transpiler.emitJavaScript leaves string_ord_at as a runtime builtin call", () => {
    const source = 'code = string_ord_at("A", 1)';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_ord_at("A", 1)'), "Should call string_ord_at directly");
});

void test("Transpiler.emitJavaScript leaves string_pos as a runtime builtin call", () => {
    const source = 'pos = string_pos("l", "hello")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_pos("l", "hello")'), "Should call string_pos directly");
});

void test("Transpiler.emitJavaScript leaves string_copy as a runtime builtin call", () => {
    const source = 'sub = string_copy("hello", 2, 3)';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_copy("hello", 2, 3)'), "Should call string_copy directly");
});

void test("Transpiler.emitJavaScript leaves string_delete as a runtime builtin call", () => {
    const source = 'result = string_delete("hello", 2, 2)';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_delete("hello", 2, 2)'), "Should call string_delete directly");
});

void test("Transpiler.emitJavaScript leaves string_insert as a runtime builtin call", () => {
    const source = 'result = string_insert("X", "hello", 3)';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_insert("X", "hello", 3)'), "Should call string_insert directly");
});

void test("Transpiler.emitJavaScript leaves string_replace as a runtime builtin call", () => {
    const source = 'result = string_replace("hello", "l", "L")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_replace("hello", "l", "L")'), "Should call string_replace directly");
});

void test("Transpiler.emitJavaScript leaves string_replace_all as a runtime builtin call", () => {
    const source = 'result = string_replace_all("hello", "l", "L")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_replace_all("hello", "l", "L")'), "Should call string_replace_all directly");
});

void test("Transpiler.emitJavaScript leaves string_count as a runtime builtin call", () => {
    const source = 'count = string_count("l", "hello")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_count("l", "hello")'), "Should call string_count directly");
});

void test("Transpiler.emitJavaScript leaves string_upper as a runtime builtin call", () => {
    const source = 'upper = string_upper("hello")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_upper("hello")'), "Should call string_upper directly");
});

void test("Transpiler.emitJavaScript leaves string_lower as a runtime builtin call", () => {
    const source = 'lower = string_lower("HELLO")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_lower("HELLO")'), "Should call string_lower directly");
});

void test("Transpiler.emitJavaScript leaves string_repeat as a runtime builtin call", () => {
    const source = 'repeated = string_repeat("ab", 3)';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_repeat("ab", 3)'), "Should call string_repeat directly");
});

void test("Transpiler.emitJavaScript leaves string_letters as a runtime builtin call", () => {
    const source = 'letters = string_letters("a1b2c3")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_letters("a1b2c3")'), "Should call string_letters directly");
});

void test("Transpiler.emitJavaScript leaves string_digits as a runtime builtin call", () => {
    const source = 'digits = string_digits("a1b2c3")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_digits("a1b2c3")'), "Should call string_digits directly");
});

void test("Transpiler.emitJavaScript leaves string_lettersdigits as a runtime builtin call", () => {
    const source = 'alphanumeric = string_lettersdigits("a1!b2@c3")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('string_lettersdigits("a1!b2@c3")'), "Should call string_lettersdigits directly");
});

void test("Transpiler.emitJavaScript leaves chr as a runtime builtin call", () => {
    const source = "ch = chr(65)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("chr(65)"), "Should call chr directly");
});

void test("Transpiler.emitJavaScript leaves ord as a runtime builtin call", () => {
    const source = 'code = ord("A")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('ord("A")'), "Should call ord directly");
});

void test("Transpiler.emitJavaScript leaves real as a runtime builtin call", () => {
    const source = 'num = real("123.45")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('real("123.45")'), "Should call real directly");
});

void test("Transpiler.emitJavaScript leaves string as a runtime builtin call", () => {
    const source = "str = string(123)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("string(123)"), "Should call string directly");
});

void test("Transpiler.emitJavaScript handles string functions with wrong argument count gracefully", () => {
    const source = 'len = string_length("a", "b")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("string_length"), "Should fall back when arg count is wrong");
});

void test("Transpiler.emitJavaScript leaves random as a runtime builtin call", () => {
    const source = "val = random(100)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("random(100)"), "Should call random directly");
});

void test("Transpiler.emitJavaScript leaves random_range as a runtime builtin call", () => {
    const source = "val = random_range(10, 20)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("random_range(10, 20)"), "Should call random_range directly");
});

void test("Transpiler.emitJavaScript leaves irandom as a runtime builtin call", () => {
    const source = "val = irandom(10)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("irandom(10)"), "Should call irandom directly");
});

void test("Transpiler.emitJavaScript leaves irandom_range as a runtime builtin call", () => {
    const source = "val = irandom_range(5, 15)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("irandom_range(5, 15)"), "Should call irandom_range directly");
});

void test("Transpiler.emitJavaScript leaves choose as a runtime builtin call", () => {
    const source = 'choice = choose("a", "b", "c")';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('choose("a", "b", "c")'), "Should call choose directly");
});

void test("Transpiler.emitJavaScript leaves choose with numeric arguments as a runtime builtin call", () => {
    const source = "choice = choose(1, 2, 3, 4, 5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("choose(1, 2, 3, 4, 5)"), "Should call choose directly");
});

void test("Transpiler.emitJavaScript leaves lerp as a runtime builtin call", () => {
    const source = "val = lerp(0, 100, 0.5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("lerp(0, 100, 0.5)"), "Should call lerp directly");
});

void test("Transpiler.emitJavaScript leaves median as a runtime builtin call", () => {
    const source = "val = median(3, 1, 2)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("median(3, 1, 2)"), "Should call median directly");
});

void test("Transpiler.emitJavaScript leaves median with even count as a runtime builtin call", () => {
    const source = "val = median(1, 2, 3, 4)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("median(1, 2, 3, 4)"), "Should call median directly");
});

void test("Transpiler.emitJavaScript leaves mean as a runtime builtin call", () => {
    const source = "val = mean(10, 20, 30)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("mean(10, 20, 30)"), "Should call mean directly");
});

void test("Transpiler.emitJavaScript handles random functions with wrong argument count gracefully", () => {
    const source = "val = random(10, 20)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("random("), "Should fall back when arg count is wrong");
});

void test("Transpiler.emitJavaScript handles new expression without arguments", () => {
    const source = "var obj = new MyStruct()";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("new MyStruct()"), "Should emit new expression with empty arguments");
});

void test("Transpiler.emitJavaScript handles new expression with single argument", () => {
    const source = "var vec = new Vector2(5)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("new Vector2(5)"), "Should emit new expression with single argument");
});

void test("Transpiler.emitJavaScript handles new expression with multiple arguments", () => {
    const source = "var vec = new Vector2(x, y)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("new Vector2(x, y)"), "Should emit new expression with multiple arguments");
});

void test("Transpiler.emitJavaScript handles new expression with literal arguments", () => {
    const source = 'var player = new Player("Alice", 100, 50)';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes('new Player("Alice", 100, 50)'), "Should emit new expression with literal arguments");
});

void test("Transpiler.emitJavaScript handles new expression with expression arguments", () => {
    const source = "var obj = new GameObject(x + 10, y * 2)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(
        result.includes("new GameObject((x + 10), (y * 2))"),
        "Should emit new expression with expression arguments"
    );
});

void test("Transpiler.emitJavaScript handles nested new expressions", () => {
    const source = "var container = new Container(new Item())";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("new Container(new Item())"), "Should emit nested new expressions");
});

void test("Transpiler.emitJavaScript handles new expression in assignment chain", () => {
    const source = "obj.component = new Component(data)";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(
        result.includes("obj.component = new Component(data)"),
        "Should emit new expression in property assignment"
    );
});

void test("Transpiler.emitJavaScript handles delete statement with identifier", () => {
    const source = "delete myVar";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("delete myVar"), "Should emit delete statement with identifier");
});

void test("Transpiler.emitJavaScript handles delete statement with property access", () => {
    const source = "delete obj.property";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("delete obj.property"), "Should emit delete statement with property access");
});

void test("Transpiler.emitJavaScript handles delete statement with array index", () => {
    const source = "delete arr[0]";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("delete arr[0]"), "Should emit delete statement with array index");
});

void test("Transpiler.emitJavaScript handles delete statement with nested property access", () => {
    const source = "delete obj.nested.property";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("delete obj.nested.property"), "Should emit delete statement with nested property");
});

void test("Transpiler.emitJavaScript handles delete statement with computed property", () => {
    const source = 'delete obj[$ "key"]';
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("delete obj"), "Should emit delete statement with computed property");
});

void test("Transpiler.emitJavaScript handles multiple delete statements", () => {
    const source = "delete obj.a; delete obj.b;";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(
        result.includes("delete obj.a") && result.includes("delete obj.b"),
        "Should emit multiple delete statements"
    );
});

void test("Transpiler.emitJavaScript handles delete in control flow", () => {
    const source = "if (condition) delete obj.temp;";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("delete obj.temp"), "Should emit delete inside conditional");
});

// Compound Assignment Operators Tests
void test("Transpiler.emitJavaScript handles += operator", () => {
    const source = "x += 5";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("x += 5"), "Should emit += operator");
});

void test("Transpiler.emitJavaScript handles -= operator", () => {
    const source = "y -= 3";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("y -= 3"), "Should emit -= operator");
});

void test("Transpiler.emitJavaScript handles *= operator", () => {
    const source = "z *= 2";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("z *= 2"), "Should emit *= operator");
});

void test("Transpiler.emitJavaScript handles /= operator", () => {
    const source = "w /= 4";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("w /= 4"), "Should emit /= operator");
});

void test("Transpiler.emitJavaScript handles %= operator", () => {
    const source = "a %= 10";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("a %= 10"), "Should emit %= operator");
});

void test("Transpiler.emitJavaScript handles &= operator", () => {
    const source = "b &= 7";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("b &= 7"), "Should emit &= operator");
});

void test("Transpiler.emitJavaScript handles |= operator", () => {
    const source = "c |= 3";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("c |= 3"), "Should emit |= operator");
});

void test("Transpiler.emitJavaScript handles ^= operator", () => {
    const source = "d ^= 1";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("d ^= 1"), "Should emit ^= operator");
});

void test("Transpiler.emitJavaScript handles <<= operator", () => {
    const source = "e <<= 2";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("e <<= 2"), "Should emit <<= operator");
});

void test("Transpiler.emitJavaScript handles >>= operator", () => {
    const source = "f >>= 1";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("f >>= 1"), "Should emit >>= operator");
});

void test("Transpiler.emitJavaScript handles compound assignment with complex expression", () => {
    const source = "score += bonus * multiplier";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(
        result.includes("score += (bonus * multiplier)"),
        "Should emit compound assignment with complex expression"
    );
});

void test("Transpiler.emitJavaScript handles compound assignment with property access", () => {
    const source = "player.health -= damage";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("player.health -= damage"), "Should emit compound assignment on property");
});

void test("Transpiler.emitJavaScript handles compound assignment with array index", () => {
    const source = "arr[i] += value";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("arr[i] += value"), "Should emit compound assignment on array element");
});

void test("Transpiler.emitJavaScript handles compound assignment in control flow", () => {
    const source = `
        if (alive) {
            health -= 10
        }
    `;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("health -= 10"), "Should emit compound assignment in if block");
});

void test("Transpiler.emitJavaScript handles compound assignment with nested property access", () => {
    const source = "game.player.stats.strength *= level";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(
        result.includes("game.player.stats.strength *= level"),
        "Should emit compound assignment on nested property"
    );
});

void test("Transpiler.emitJavaScript handles multiple compound assignments", () => {
    const source = `
        x += 1
        y -= 2
        z *= 3
    `;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("x += 1"), "Should emit first compound assignment");
    assert.ok(result.includes("y -= 2"), "Should emit second compound assignment");
    assert.ok(result.includes("z *= 3"), "Should emit third compound assignment");
});

void test("Transpiler.emitJavaScript handles compound assignment with function call result", () => {
    const source = "total += calculate_bonus()";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("total += calculate_bonus()"), "Should emit compound assignment with function call");
});

void test("Transpiler.emitJavaScript handles compound assignment with parenthesized expression", () => {
    const source = "result += (a + b) * c";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("result +="), "Should emit compound assignment");
    assert.ok(result.includes("(a + b)"), "Should preserve parenthesization in right-hand side");
});

void test("Transpiler.emitJavaScript handles compound assignment in loop", () => {
    const source = `
        for (var i = 0; i < 10; i += 1) {
            sum += i
        }
    `;
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.ok(result.includes("i += 1"), "Should emit compound assignment in for loop update");
    assert.ok(result.includes("sum += i"), "Should emit compound assignment in loop body");
});

void test("GmlToJsEmitter handles unknown node types gracefully", () => {
    // Create a mock AST node with an unrecognized type
    const mockAst = createMockUnknownNode("UnknownNodeType");

    // The emitter should handle unknown nodes gracefully by returning empty string
    const emitter = new Transpiler.GmlToJsEmitter(Transpiler.createSemanticOracle());
    const result = emitter.emit(mockAst as unknown as Parameters<typeof emitter.emit>[0]);

    assert.strictEqual(result, "", "Should return empty string for unknown node types");
});

// Integration tests for unary constant folding in the emitter

void test("Transpiler.emitJavaScript folds constant unary negation", () => {
    const code = "var x = -5;";
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result, "var x = -5;");
});

void test("Transpiler.emitJavaScript folds constant unary plus", () => {
    const code = "var x = +42;";
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result, "var x = 42;");
});

void test("Transpiler.emitJavaScript folds constant bitwise NOT", () => {
    const code = "var x = ~15;";
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result, "var x = -16;");
});

void test("Transpiler.emitJavaScript folds constant logical NOT on true", () => {
    const code = "var x = !true;";
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result, "var x = false;");
});

void test("Transpiler.emitJavaScript folds constant logical NOT on false", () => {
    const code = "var x = !false;";
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result, "var x = true;");
});

void test("Transpiler.emitJavaScript folds constant GML not keyword", () => {
    const code = "var x = not true;";
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result, "var x = false;");
});

void test("Transpiler.emitJavaScript does not fold unary with variable operand", () => {
    const code = "var x = -y;";
    const parser = new Parser.GMLParser(code);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);
    assert.strictEqual(result, "var x = -(y);");
});

void test("GmlToJsEmitter folds ternary expressions with constant boolean conditions", () => {
    const source = "result = true ? expensive() : cheap()";
    const parser = new Parser.GMLParser(source, {});
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.match(result, /^result = expensive\(\);$/, "Should emit only the selected ternary branch");
});
