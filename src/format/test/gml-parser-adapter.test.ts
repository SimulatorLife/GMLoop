import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gmlParserAdapter } from "../src/parsers/index.js";

void describe("gml parser adapter", () => {
    const sourceWithMissingBrace = [
        "function func_args()",
        "{",
        "",
        "",
        "var value = argument[0];",
        "show_debug_message(value);",
        "return value;"
    ].join("\n");

    void it("propagates parser errors for malformed source", async () => {
        assert.throws(
            () => gmlParserAdapter.parse(sourceWithMissingBrace),
            (error) =>
                typeof (error as any)?.message === "string" &&
                (error as any).message.toLowerCase().includes("missing associated closing brace"),
            "Expected parser to report missing closing brace."
        );
    });

    void it("rejects scr_matrix_build calls that omit separators between numeric literals", async () => {
        const source = ["if (scr_matrix_build(1, 2 3, 4)) {", "    return 0;", "}"].join("\n");
        assert.throws(() => gmlParserAdapter.parse(source));
    });

    void it("rejects scr_matrix_build calls with inline comments between numeric literals", async () => {
        const source = ["if (scr_matrix_build(1, 2 /* note */ 3, 4)) {", "    return 1;", "}"].join("\n");
        assert.throws(() => gmlParserAdapter.parse(source));
    });

    void it("rejects generic calls that omit separators between numeric literals", async () => {
        const source = ["if (do_generic(0, 1 2, 3)) {", "    return 2;", "}"].join("\n");
        assert.throws(() => gmlParserAdapter.parse(source));
    });

    void it("does not opt into parser-owned function doc-comment attachment during formatter parsing", async () => {
        const source = [
            "// @function legacy_doc_alias(arg0)",
            "function legacy_doc_alias(arg0) {",
            "    return arg0;",
            "}"
        ].join("\n");

        const ast = gmlParserAdapter.parse(source) as { body?: Array<{ type?: string; docComments?: unknown[] }> };
        const functionDeclaration = (ast.body ?? []).find((node) => node?.type === "FunctionDeclaration");

        assert.ok(functionDeclaration, "Expected a FunctionDeclaration node in the parsed AST.");
        assert.equal(
            (functionDeclaration?.docComments ?? []).length,
            0,
            "Formatter parser path must remain layout-only and avoid parser doc-tag attachment heuristics."
        );
    });
});
