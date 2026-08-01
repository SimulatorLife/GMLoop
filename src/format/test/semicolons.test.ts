import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AstPath } from "prettier";

import * as Semicolons from "../src/printer/semicolons.js";

void describe("semicolon helpers", () => {
    void it("flags statement nodes that require a terminator", () => {
        assert.strictEqual(Semicolons.optionalSemicolon("ExpressionStatement"), ";");
        assert.strictEqual(Semicolons.optionalSemicolon("IfStatement"), "");
    });

    void it("does not treat prototype keys as semicolon node types", () => {
        assert.strictEqual(Semicolons.optionalSemicolon("__proto__"), "");
        assert.strictEqual(Semicolons.optionalSemicolon("toString"), "");
    });

    void it("determines whether the path references the last statement", () => {
        const body = ["first", "second", "third"];
        const parent = { body };

        const pathForLast = {
            getParentNode: () => parent,
            getValue: () => body.at(-1)
        } as unknown as AstPath<unknown>;

        assert.strictEqual(Semicolons.isLastStatement(pathForLast), true);

        const pathForFirst = {
            getParentNode: () => parent,
            getValue: () => body[0]
        } as unknown as AstPath<unknown>;

        assert.strictEqual(Semicolons.isLastStatement(pathForFirst), false);

        const orphanPath = {
            getParentNode: () => null,
            getValue: () => ({})
        } as unknown as AstPath<unknown>;

        assert.strictEqual(Semicolons.isLastStatement(orphanPath), true);
    });
});
