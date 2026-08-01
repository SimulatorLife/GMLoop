/**
 * @file loop-like-node.test.ts
 *
 * ## Purpose
 *
 * This file exists for historical reasons and as a navigation anchor.
 * All substantive coverage for `Core.isLoopLikeNode` has been consolidated
 * into `src/transpiler/test/type-guards.test.ts` under the unified describe
 * block "isLoopLikeNode (Core) and isLoopStatement (transpiler)".
 *
 * The transpiler also exports `isLoopStatement`, which implements the same
 * contract (ForStatement | WhileStatement | DoUntilStatement | RepeatStatement).
 * Both guards are tested together there to confirm they agree on every input,
 * including edge cases for null, undefined, primitives, missing types, and
 * non-string type values.
 *
 * Deleting this file would break existing import paths, so it is retained as
 * a minimal stub. Do not add new test cases here — add them to the unified
 * describe block in the transpiler type-guards test instead.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../index.js";

void describe("Core.isLoopLikeNode — stub (consolidated)", () => {
    void it("is defined on Core", () => {
        assert.equal(typeof Core.isLoopLikeNode, "function");
    });
});
