import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

/**
 * Tests for GML hex and binary literal transpilation.
 *
 * GML supports three hex prefixes and one binary prefix:
 *   - `0xFF`   — standard C/JS hex prefix, valid in JavaScript as-is
 *   - `$FF`    — GML dollar-sign hex prefix, NOT valid in JavaScript
 *   - `#FFFFFF` — GML hash hex prefix, NOT valid in JavaScript
 *   - `0b1010` — binary literal, valid in JavaScript as-is (ES2015+)
 *
 * The transpiler must normalize GML-specific prefixes to their `0x`-prefixed
 * JavaScript equivalents so that emitted patches run without syntax errors in
 * the GameMaker HTML5 runtime.
 */

void describe("GML hex literal transpilation", () => {
    void describe("0x-prefixed hex literals (standard C/JS notation)", () => {
        void it("emits 0x hex literal in simple assignment", () => {
            const ast = Parser.GMLParser.parse("x = 0xFF");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFF"), `expected 0xFF in output, got: ${js}`);
        });

        void it("emits 0x hex literal in variable declaration", () => {
            const ast = Parser.GMLParser.parse("var mask = 0xFF00FF");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFF00FF"), `expected 0xFF00FF in output, got: ${js}`);
        });

        void it("emits 0x hex literal in compound assignment", () => {
            const ast = Parser.GMLParser.parse("flags |= 0x01");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0x01"), `expected 0x01 in output, got: ${js}`);
            assert.ok(js.includes("|="), `expected |= operator, got: ${js}`);
        });

        void it("emits 0x hex literal in binary expression", () => {
            const ast = Parser.GMLParser.parse("var masked = value & 0xFF");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFF"), `expected 0xFF in output, got: ${js}`);
        });

        void it("emits 0x hex literal in bitwise AND compound assignment", () => {
            const ast = Parser.GMLParser.parse("flags &= 0xF0");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xF0"), `expected 0xF0 in output, got: ${js}`);
        });
    });

    void describe("$-prefixed hex literals (GML dollar-sign notation)", () => {
        void it("converts $FF to 0xFF in simple assignment", () => {
            const ast = Parser.GMLParser.parse("x = $FF");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFF"), `expected 0xFF in output, got: ${js}`);
            assert.ok(!js.includes("$FF"), `$FF should be converted to 0xFF, got: ${js}`);
        });

        void it("converts $FFFFFF to 0xFFFFFF in variable declaration", () => {
            const ast = Parser.GMLParser.parse("var color = $FFFFFF");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFFFFFF"), `expected 0xFFFFFF in output, got: ${js}`);
            assert.ok(!js.includes("$FFFFFF"), `$FFFFFF should be converted, got: ${js}`);
        });

        void it("converts $00FF00 to 0x00FF00 in expression", () => {
            const ast = Parser.GMLParser.parse("draw_set_colour($00FF00)");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0x00FF00"), `expected 0x00FF00 in output, got: ${js}`);
        });
    });

    void describe("#-prefixed hex literals (GML hash notation)", () => {
        void it("converts #FFFFFF to 0xFFFFFF in simple assignment", () => {
            const ast = Parser.GMLParser.parse("x = #FFFFFF");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFFFFFF"), `expected 0xFFFFFF in output, got: ${js}`);
            assert.ok(!js.includes("#FFFFFF"), `#FFFFFF should be converted to 0xFFFFFF, got: ${js}`);
        });

        void it("converts #FF0000 to 0xFF0000 in expression", () => {
            const ast = Parser.GMLParser.parse("var col = #FF0000");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFF0000"), `expected 0xFF0000 in output, got: ${js}`);
        });

        void it("converts #000000 to 0x000000 in assignment", () => {
            const ast = Parser.GMLParser.parse("bg_color = #000000");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0x000000"), `expected 0x000000 in output, got: ${js}`);
        });
    });

    void describe("binary literals (0b notation)", () => {
        void it("emits 0b binary literal in assignment", () => {
            const ast = Parser.GMLParser.parse("x = 0b1010");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0b1010"), `expected 0b1010 in output, got: ${js}`);
        });

        void it("emits 0b binary literal in variable declaration", () => {
            const ast = Parser.GMLParser.parse("var flags = 0b11001100");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0b11001100"), `expected 0b11001100 in output, got: ${js}`);
        });

        void it("emits 0b binary literal in bitwise expression", () => {
            const ast = Parser.GMLParser.parse("var result = mask & 0b00001111");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0b00001111"), `expected 0b00001111 in output, got: ${js}`);
        });
    });

    void describe("hex literals in control flow and complex expressions", () => {
        void it("emits hex literal in if condition", () => {
            const ast = Parser.GMLParser.parse("if (flags & 0x01) { active = true; }");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0x01"), `expected 0x01 in output, got: ${js}`);
        });

        void it("emits 0x hex in for-loop", () => {
            const ast = Parser.GMLParser.parse("for (var i = 0; i < 0xFF; i++) { }");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFF"), `expected 0xFF in output, got: ${js}`);
        });

        void it("converts $ hex in function argument", () => {
            const ast = Parser.GMLParser.parse("draw_set_colour($FF0000)");
            const js = Transpiler.emitJavaScript(ast);
            assert.ok(js.includes("0xFF0000"), `expected 0xFF0000 in output, got: ${js}`);
        });

        void it("handles multiple hex literals in one statement", () => {
            const ast = Parser.GMLParser.parse("var col = 0xFF0000 | 0x00FF00 | 0x0000FF");
            const js = Transpiler.emitJavaScript(ast);
            // Constant folding may combine adjacent hex literals at compile time.
            // The output must either contain individual 0x literals or their folded
            // decimal equivalent (0xFFFFFF = 16777215).
            assert.ok(js.includes("var col ="), `expected variable declaration, got: ${js}`);
            const hasFoldedResult = js.includes("16777215") || js.includes("0xFFFFFF");
            const hasPartialFold = js.includes("0x0000FF") || js.includes("0x00FF00") || js.includes("0xFF0000");
            assert.ok(
                hasFoldedResult || hasPartialFold,
                `expected hex literals or folded constant in output, got: ${js}`
            );
            // GML-specific prefixes must not appear in JavaScript output
            assert.ok(!js.includes("$"), `$ prefix should not appear in JS output, got: ${js}`);
        });
    });
});

void describe("normalizeGmlNumericLiteral", () => {
    void it("converts $ prefix to 0x prefix", () => {
        assert.equal(Transpiler.normalizeGmlNumericLiteral("$FF"), "0xFF");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("$00"), "0x00");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("$FFFFFF"), "0xFFFFFF");
    });

    void it("converts # prefix to 0x prefix for pure hex strings", () => {
        assert.equal(Transpiler.normalizeGmlNumericLiteral("#FF"), "0xFF");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("#FFFFFF"), "0xFFFFFF");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("#000000"), "0x000000");
    });

    void it("passes through standard 0x-prefixed hex literals unchanged", () => {
        assert.equal(Transpiler.normalizeGmlNumericLiteral("0xFF"), "0xFF");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("0x1A"), "0x1A");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("0x00"), "0x00");
    });

    void it("passes through binary literals unchanged", () => {
        assert.equal(Transpiler.normalizeGmlNumericLiteral("0b1010"), "0b1010");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("0b11001100"), "0b11001100");
    });

    void it("passes through decimal literals unchanged", () => {
        assert.equal(Transpiler.normalizeGmlNumericLiteral("255"), "255");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("3.14"), "3.14");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("0"), "0");
    });

    void it("does not convert non-hex hash strings", () => {
        // A hash followed by non-hex characters is not a hex literal
        assert.equal(Transpiler.normalizeGmlNumericLiteral("#notahex"), "#notahex");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("#GGG"), "#GGG");
    });

    void it("handles uppercase and lowercase hex digits", () => {
        assert.equal(Transpiler.normalizeGmlNumericLiteral("$ff"), "0xff");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("$FF"), "0xFF");
        assert.equal(Transpiler.normalizeGmlNumericLiteral("#aabbcc"), "0xaabbcc");
    });
});
