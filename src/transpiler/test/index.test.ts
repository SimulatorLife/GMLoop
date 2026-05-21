import assert from "node:assert/strict";
import test from "node:test";

import { Transpiler } from "../index.js";
import { TranspilerError, TranspilerErrorCode } from "../src/api/errors.js";

type TranspilerInstance = InstanceType<typeof Transpiler.GmlTranspiler>;
type TranspileScriptArgs = Parameters<TranspilerInstance["transpileScript"]>[0];

void test("transpileScript validates inputs", () => {
    const transpiler = new Transpiler.GmlTranspiler();
    assert.throws(
        () =>
            transpiler.transpileScript({
                symbolId: "gml/script/foo"
            } as unknown as TranspileScriptArgs),
        { name: "TypeError" }
    );
});

void test("transpileScript unwraps function bodies without leading blank lines", () => {
    const transpiler = new Transpiler.GmlTranspiler();
    const result = transpiler.transpileScript({
        sourceText: "function test() { return 1; }",
        symbolId: "gml/script/test"
    });

    assert.equal(result.js_body, "return 1;");
});

void test("transpileScript includes source path metadata when provided", () => {
    const transpiler = new Transpiler.GmlTranspiler();
    const result = transpiler.transpileScript({
        sourceText: "x = 1 + 2",
        symbolId: "gml/script/test",
        sourcePath: "scripts/player_move.gml"
    });

    assert.equal(result.metadata?.sourcePath, "scripts/player_move.gml");
});

void test("transpileScript unwraps function parameters into args assignments", () => {
    const transpiler = new Transpiler.GmlTranspiler();
    const result = transpiler.transpileScript({
        sourceText: "function test(x, y = 5) { return x + y; }",
        symbolId: "gml/script/test"
    });

    assert.match(result.js_body, /^var x = args\[0\];/m);
    assert.match(result.js_body, /^var y = args\[1\] === undefined \? 5 : args\[1\];/m);
    assert.match(result.js_body, /return \(?x \+ y\)?;/);
});

void test("transpileScript reuses pre-parsed function ASTs with string parameters", () => {
    const transpiler = new Transpiler.GmlTranspiler();
    const result = transpiler.transpileScript({
        sourceText: "function test(x, y = 5) { return x + y; }",
        symbolId: "gml/script/test",
        ast: {
            type: "Program",
            body: [
                {
                    type: "FunctionDeclaration",
                    id: "test",
                    params: [
                        "x",
                        {
                            type: "DefaultParameter",
                            left: { type: "Identifier", name: "y" },
                            right: { type: "Literal", value: 5 }
                        }
                    ],
                    body: {
                        type: "BlockStatement",
                        body: [
                            {
                                type: "ReturnStatement",
                                argument: {
                                    type: "BinaryExpression",
                                    operator: "+",
                                    left: { type: "Identifier", name: "x" },
                                    right: { type: "Identifier", name: "y" }
                                }
                            }
                        ]
                    }
                }
            ]
        }
    });

    assert.equal(result.js_body, "var x = args[0];\nvar y = args[1] === undefined ? 5 : args[1];\nreturn (x + y);");
});

void test("transpileScript rejects empty source paths", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    assert.throws(
        () =>
            transpiler.transpileScript({
                sourceText: "x = 1 + 2",
                symbolId: "gml/script/test",
                sourcePath: ""
            }),
        { name: "TypeError" }
    );
});

void test("transpileExpression generates JavaScript for simple expressions", () => {
    const transpiler = new Transpiler.GmlTranspiler();
    const result = transpiler.transpileExpression("x = 1 + 2");
    assert.ok(result, "Should generate some output");
});

void test("transpileScript rejects malformed ast objects before property access", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    assert.throws(
        () =>
            transpiler.transpileScript({
                sourceText: "x = 1 + 2",
                symbolId: "gml/script/test",
                ast: { type: "Program" }
            }),
        {
            message: /ast\.body to be an array/
        }
    );
});

void test("transpileScript rejects non-Program ast objects", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    assert.throws(
        () =>
            transpiler.transpileScript({
                sourceText: "x = 1 + 2",
                symbolId: "gml/script/test",
                ast: { type: "BinaryExpression", body: [] }
            }),
        {
            message: /ast\.type to be 'Program'/
        }
    );
});

void test("transpileScript handles parsing errors gracefully", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    assert.throws(
        () =>
            transpiler.transpileScript({
                sourceText: "invalid syntax %%%%",
                symbolId: "gml/script/test"
            }),
        { message: /Failed to transpile script/ }
    );
});

void test("transpileExpression handles parsing errors gracefully", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    assert.throws(() => transpiler.transpileExpression("invalid syntax %%%%"), {
        message: /Failed to transpile expression/
    });
});

void test("transpileScript preserves the original error as cause", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    try {
        transpiler.transpileScript({
            sourceText: "invalid syntax %%%%",
            symbolId: "gml/script/test"
        });
        assert.fail("Expected transpileScript to throw");
    } catch (error) {
        assert.ok(error instanceof Error);
        assert.ok(error.cause instanceof Error);
    }
});

void test("transpileScript throws TranspilerError with INTERNAL_ERROR code on parse failure", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    let caughtError: unknown;
    try {
        transpiler.transpileScript({
            sourceText: "invalid syntax %%%%",
            symbolId: "gml/script/test"
        });
    } catch (error) {
        caughtError = error;
    }

    if (!(caughtError instanceof Error)) {
        assert.fail("Expected transpileScript to throw an Error");
    }
    if (!(caughtError instanceof TranspilerError)) {
        assert.fail(`Expected error to be a TranspilerError, got: ${caughtError.constructor.name}`);
    }
    assert.equal(caughtError.code, TranspilerErrorCode.INTERNAL_ERROR, "Should have INTERNAL_ERROR code");
    assert.ok(caughtError.cause instanceof Error, "Should preserve the original error as cause");
    assert.ok(caughtError.message.includes("Failed to transpile script"), "Message should include context");
});

void test("transpileExpression throws TranspilerError with INTERNAL_ERROR code on parse failure", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    let caughtError: unknown;
    try {
        transpiler.transpileExpression("invalid syntax %%%%");
    } catch (error) {
        caughtError = error;
    }

    if (!(caughtError instanceof TranspilerError)) {
        assert.fail(`Expected error to be a TranspilerError, got: ${caughtError.constructor.name}`);
    }
    assert.equal(caughtError.code, TranspilerErrorCode.INTERNAL_ERROR);
    assert.ok(caughtError.message.includes("Failed to transpile expression"));
});

void test("transpileEvent throws TranspilerError with INTERNAL_ERROR code on parse failure", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    let caughtError: unknown;
    try {
        transpiler.transpileEvent({
            sourceText: "invalid syntax %%%%",
            symbolId: "gml/event/obj_player/create"
        });
    } catch (error) {
        caughtError = error;
    }

    assert.ok(caughtError instanceof TranspilerError, "Should be a TranspilerError");
    assert.equal(caughtError.code, TranspilerErrorCode.INTERNAL_ERROR);
    assert.ok(caughtError.message.includes("Failed to transpile event"));
});

void test("transpileClosure throws TranspilerError with INTERNAL_ERROR code on parse failure", () => {
    const transpiler = new Transpiler.GmlTranspiler();

    let caughtError: unknown;
    try {
        transpiler.transpileClosure({
            sourceText: "invalid syntax %%%%",
            symbolId: "gml/closure/scr_helper"
        });
    } catch (error) {
        caughtError = error;
    }

    assert.ok(caughtError instanceof TranspilerError, "Should be a TranspilerError");
    assert.equal(caughtError.code, TranspilerErrorCode.INTERNAL_ERROR);
    assert.ok(caughtError.message.includes("Failed to transpile closure"));
});

void test("TranspilerError has correct properties", () => {
    const error = new TranspilerError("Test error message", TranspilerErrorCode.VALIDATION_ERROR, {
        cause: new Error("Original cause")
    });

    assert.equal(error.name, "TranspilerError");
    assert.equal(error.message, "Test error message");
    assert.equal(error.code, TranspilerErrorCode.VALIDATION_ERROR);
    assert.ok(error.cause instanceof Error);
    assert.ok(error.cause?.message.includes("Original cause"));
});

void test("TranspilerErrorCode enum has all expected values", () => {
    assert.equal(typeof TranspilerErrorCode.PARSE_ERROR, "string");
    assert.equal(TranspilerErrorCode.PARSE_ERROR, "PARSE_ERROR");

    assert.equal(typeof TranspilerErrorCode.VALIDATION_ERROR, "string");
    assert.equal(TranspilerErrorCode.VALIDATION_ERROR, "VALIDATION_ERROR");

    assert.equal(typeof TranspilerErrorCode.REQUEST_ERROR, "string");
    assert.equal(TranspilerErrorCode.REQUEST_ERROR, "REQUEST_ERROR");

    assert.equal(typeof TranspilerErrorCode.INTERNAL_ERROR, "string");
    assert.equal(TranspilerErrorCode.INTERNAL_ERROR, "INTERNAL_ERROR");
});
