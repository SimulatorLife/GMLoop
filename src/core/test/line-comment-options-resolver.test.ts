/**
 * Resolver lifecycle tests for `setLineCommentOptionsResolver` /
 * `restoreDefaultLineCommentOptionsResolver`.
 *
 * The default-and-custom-resolver behaviour of `resolveLineCommentOptions` is
 * exhaustively covered (with stricter identity assertions) in
 * `comments/line-comment-options-normalization.test.ts`; this file focuses on
 * the lifecycle entry points that have no peer there.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";

const {
    resolveLineCommentOptions,
    setLineCommentOptionsResolver,
    restoreDefaultLineCommentOptionsResolver,
    DEFAULT_LINE_COMMENT_OPTIONS
} = Core;

void describe("line comment options resolver", () => {
    void it("restores the default state after clearing the resolver", () => {
        restoreDefaultLineCommentOptionsResolver();
        const sqlPattern = /^SQL:/i;

        setLineCommentOptionsResolver(() => ({
            codeDetectionPatterns: [...DEFAULT_LINE_COMMENT_OPTIONS.codeDetectionPatterns, sqlPattern]
        }));

        const customResult = resolveLineCommentOptions();
        assert.strictEqual(customResult.codeDetectionPatterns.at(-1), sqlPattern);

        const restored = restoreDefaultLineCommentOptionsResolver();
        assert.deepEqual(restored, DEFAULT_LINE_COMMENT_OPTIONS);
        assert.deepEqual(resolveLineCommentOptions(), DEFAULT_LINE_COMMENT_OPTIONS);
    });

    void it("throws when set is called with a non-function", () => {
        assert.throws(() => {
            setLineCommentOptionsResolver("not a function" as any);
        }, TypeError);
    });
});
