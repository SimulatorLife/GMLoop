import assert from "node:assert/strict";
import test from "node:test";

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

void test("GmlToJsEmitter emits undefined for missing optional arguments", () => {
    const source = "func(, arg2);";
    const parser = new Parser.GMLParser(source);
    const ast = parser.parse();
    const result = Transpiler.emitJavaScript(ast);

    assert.match(result, /func\(undefined, arg2\);/, "Should preserve missing argument position as undefined");
});
