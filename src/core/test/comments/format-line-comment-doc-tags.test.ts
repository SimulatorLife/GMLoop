import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../../index.js";

const { formatLineComment } = Core;

/**
 * Builds a parser-style CommentLine node that `formatLineComment` can consume.
 *
 * The formatter only relies on `value`, `leadingText`, and `raw`; positional
 * `start`/`end` indices are intentionally omitted so the test contract is not
 * coupled to internal slice coordinates.
 */
function createLineComment(value, raw) {
    return {
        type: "CommentLine",
        value,
        leadingText: raw,
        raw
    };
}

void describe("formatLineComment — doc-tag normalization contract", () => {
    void it("preserves canonical override tags unchanged", () => {
        const comment = createLineComment(" @override", "/// @override");

        assert.equal(formatLineComment(comment), "/// @override");
    });

    void it("rewrites common override aliases to the canonical @override tag", () => {
        const aliases = ["@overrides", "@overide", "@overridden"];

        for (const alias of aliases) {
            const comment = createLineComment(` ${alias}`, `/// ${alias}`);

            assert.equal(formatLineComment(comment), "/// @override", `expected ${alias} to normalize to @override`);
        }
    });

    void it("rewrites function-declaration aliases to the canonical @function tag", () => {
        const aliases = ["@func", "@funct", "@method"];

        for (const alias of aliases) {
            const comment = createLineComment(` ${alias}`, `/// ${alias}`);

            assert.equal(formatLineComment(comment), "/// @function", `expected ${alias} to normalize to @function`);
        }
    });

    void it("rewrites parameter aliases to the canonical @param tag", () => {
        const aliases = ["@arg", "@argument", "@params"];

        for (const alias of aliases) {
            const comment = createLineComment(` ${alias} value description`, `/// ${alias} value description`);

            assert.equal(
                formatLineComment(comment),
                "/// @param value description",
                `expected ${alias} to normalize to @param`
            );
        }
    });

    void it("rewrites return-value aliases to the canonical @returns tag", () => {
        const aliases = ["@return", "@returns", "@yield", "@yields", "@output", "@outputs"];

        for (const alias of aliases) {
            const comment = createLineComment(` ${alias} computed value`, `/// ${alias} computed value`);

            assert.equal(
                formatLineComment(comment),
                "/// @returns computed value",
                `expected ${alias} to normalize to @returns`
            );
        }
    });

    void it("rewrites description aliases to the canonical @description tag", () => {
        const comment = createLineComment(" @desc Computes the result", "/// @desc Computes the result");

        assert.equal(formatLineComment(comment), "/// @description Computes the result");
    });

    void it("rewrites throw aliases to the canonical @throws tag", () => {
        const aliases = ["@throw", "@exception"];

        for (const alias of aliases) {
            const comment = createLineComment(` ${alias} when input is invalid`, `/// ${alias} when input is invalid`);

            assert.equal(
                formatLineComment(comment),
                "/// @throws when input is invalid",
                `expected ${alias} to normalize to @throws`
            );
        }
    });

    void it("rewrites visibility aliases to the canonical @ignore tag", () => {
        const aliases = ["@private", "@hidden", "@hide"];

        for (const alias of aliases) {
            const comment = createLineComment(` ${alias}`, `/// ${alias}`);

            assert.equal(formatLineComment(comment), "/// @ignore", `expected ${alias} to normalize to @ignore`);
        }
    });

    void it("promotes double-slash doc tags to triple-slash doc comments", () => {
        const comment = createLineComment(" @override", "// @override");

        assert.equal(formatLineComment(comment), "/// @override");
    });

    void it("promotes double-slash function aliases to canonical triple-slash form", () => {
        const comment = createLineComment(" @func myFunc", "// @func myFunc");

        assert.equal(formatLineComment(comment), "/// @function myFunc");
    });

    void it("inserts a single space between the slashes and the tag when missing", () => {
        const comment = createLineComment("@override", "///@override");

        assert.equal(formatLineComment(comment), "/// @override");
    });

    void it("preserves type annotations on @param declarations", () => {
        const comment = createLineComment(
            " @param {Struct.MyStruct} value The value to assign",
            "/// @param {Struct.MyStruct} value The value to assign"
        );

        assert.equal(formatLineComment(comment), "/// @param {Struct.MyStruct} value The value to assign");
    });

    void it("does not modify regular (non-doc) line comments", () => {
        const comment = createLineComment(" hello world", "// hello world");

        assert.equal(formatLineComment(comment), "// hello world");
    });

    void it("returns null for empty line comments so they can be elided from output", () => {
        const comment = createLineComment("", "//");

        assert.equal(formatLineComment(comment), null);
    });

    void it("normalizes aliases regardless of the leading-slash variant on the original", () => {
        const inputs = ["/// @func", "// @func", "//// @func"];

        const results = inputs.map((raw) => formatLineComment(createLineComment(" @func", raw)));

        assert.deepEqual(results, ["/// @function", "/// @function", "/// @function"]);
    });
});
