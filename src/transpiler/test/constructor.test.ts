import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

void describe("Transpiler.emitJavaScript constructor handling", () => {
    void it("converts basic constructor to function", () => {
        const source = "function MyClass () constructor {}";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.ok(js.includes("function MyClass()"), "Should emit function declaration");
        assert.ok(js.includes("{") && js.includes("}"), "Should include body braces");
    });

    void it("handles constructor with parameters", () => {
        const source = "function Vector2(x, y) constructor { self.x = x; self.y = y; }";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.ok(js.includes("function Vector2(x, y)"), "Should emit function with parameters");
        assert.ok(js.includes("self.x = x"), "Should include body statements");
    });

    void it("handles constructor with default parameters", () => {
        const source = "function Thing(value = 0) constructor {}";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.ok(js.includes("function Thing(value = 0)"), "Should handle default parameters");
    });

    void it("emits parent constructor calls before the child body", () => {
        const source = "function Vector3(x, y, z) : Vector2(x, y) constructor { self.z = z; }";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.match(js, /function Vector3\(x, y, z\)\{/, "Should emit the child constructor signature");
        assert.match(js, /Vector2\.call\(this, x, y\);/, "Should bind the parent constructor to the child instance");
        assert.match(js, /self\.z = z;/, "Should preserve child constructor statements after the parent call");
        assert.ok(
            js.indexOf("Vector2.call(this, x, y);") < js.indexOf("self.z = z;"),
            "Parent call should run before child statements"
        );
    });

    void it("supports parent constructors without arguments", () => {
        const source = "function Child() : Parent() constructor {}";
        const ast = Parser.GMLParser.parse(source);

        const js = Transpiler.emitJavaScript(ast);

        assert.match(js, /Parent\.call\(this\);/, "Should emit a zero-argument parent constructor call");
    });
});
