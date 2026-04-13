/**
 * Tests for the `removeCommentFromNodeList` helper, exercised through
 * the public `Format.format` API.
 *
 * The helper is used by `handleDecorativeBlockCommentOwnLine` to detach
 * a comment from its current node's `comments` array before re-attaching
 * it as a leading comment on the following node.  These tests verify
 * that the detach-and-reattach cycle produces correct formatting for
 * decorative block comments, which is the primary code path that
 * exercises `removeCommentFromNodeList`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Format } from "../src/index.js";

void describe("removeCommentFromNodeList via decorative block comment handling", () => {
    void it("reattaches a decorative block comment as a leading comment on the following statement", async () => {
        const source = ["/* //// banner //// */", "var x = 1;", ""].join("\n");

        const formatted = await Format.format(source);

        const bannerIndex = formatted.indexOf("/* //// banner //// */");
        const varIndex = formatted.indexOf("var x");
        assert.ok(bannerIndex !== -1, "Expected decorative block comment to be present in output");
        assert.ok(varIndex !== -1, "Expected `var x` to be present in output");
        assert.ok(
            bannerIndex < varIndex,
            "Expected decorative block comment to appear before `var x` as a leading comment"
        );
        assert.ok(
            !formatted.includes("var x = 1; /* ////"),
            "Decorative comment must not become an inline trailing comment"
        );
    });

    void it("detaches from precedingNode when comment sits between two statements", async () => {
        const source = ["var a = 1;", "/* //// separator //// */", "var b = 2;", ""].join("\n");

        const formatted = await Format.format(source);

        const bannerIndex = formatted.indexOf("/* //// separator //// */");
        const varBIndex = formatted.indexOf("var b");
        assert.ok(bannerIndex !== -1, "Expected separator comment to be present");
        assert.ok(varBIndex !== -1, "Expected `var b` to be present");
        assert.ok(
            bannerIndex < varBIndex,
            "Expected decorative block comment to remain between the two variable declarations"
        );
    });

    void it("detaches from enclosingNode when comment is inside a block", async () => {
        const source = ["function test() {", "    /* //// inner banner //// */", "    var c = 3;", "}", ""].join("\n");

        const formatted = await Format.format(source);

        assert.ok(formatted.includes("inner banner"), "Expected inner decorative block comment to be preserved");
        assert.ok(formatted.includes("var c = 3"), "Expected following statement to remain present");
    });

    void it("handles the no-op case when node has no comments array", async () => {
        const source = ["var y = 42;", ""].join("\n");

        const formatted = await Format.format(source);
        assert.ok(formatted.includes("var y = 42;"), "Basic formatting should still work");
    });
});
