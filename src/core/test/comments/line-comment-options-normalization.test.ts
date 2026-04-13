import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Core } from "../../index.js";

const {
    DEFAULT_COMMENTED_OUT_CODE_PATTERNS,
    DEFAULT_LINE_COMMENT_OPTIONS,
    formatLineComment,
    resolveLineCommentOptions,
    restoreDefaultLineCommentOptionsResolver,
    setLineCommentOptionsResolver
} = Core;

function createLineComment(value, raw = `//${value}`) {
    return {
        type: "CommentLine",
        value,
        leadingText: raw,
        raw
    };
}

void describe("resolveLineCommentOptions", () => {
    afterEach(() => {
        restoreDefaultLineCommentOptionsResolver();
    });

    void it("returns the default option object when no resolver is installed", () => {
        const resolved = resolveLineCommentOptions();

        assert.strictEqual(resolved, DEFAULT_LINE_COMMENT_OPTIONS);
        assert.strictEqual(resolved.codeDetectionPatterns, DEFAULT_COMMENTED_OUT_CODE_PATTERNS);
    });

    void it("normalizes inline option overrides when no resolver is installed", () => {
        const sqlPattern = /^SQL:/i;
        const resolved = resolveLineCommentOptions({
            codeDetectionPatterns: [...DEFAULT_COMMENTED_OUT_CODE_PATTERNS, sqlPattern]
        });

        assert.notStrictEqual(resolved, DEFAULT_LINE_COMMENT_OPTIONS);
        assert.strictEqual(resolved.codeDetectionPatterns.at(-1), sqlPattern);
    });

    void it("allows integrators to extend code-detection heuristics via resolver hook", () => {
        const sqlPattern = /^SQL:/i;
        setLineCommentOptionsResolver(() => ({
            codeDetectionPatterns: [...DEFAULT_COMMENTED_OUT_CODE_PATTERNS, sqlPattern]
        }));

        const resolved = resolveLineCommentOptions();

        assert.notStrictEqual(resolved, DEFAULT_LINE_COMMENT_OPTIONS);
        assert.strictEqual(resolved.codeDetectionPatterns.at(-1), sqlPattern);
    });

    void it("falls back to defaults when the resolver returns invalid data", () => {
        setLineCommentOptionsResolver(() => ({
            codeDetectionPatterns: ["/^SQL:/i"]
        }));

        const resolved = resolveLineCommentOptions();

        assert.strictEqual(resolved, DEFAULT_LINE_COMMENT_OPTIONS);
    });
});

void describe("formatLineComment", () => {
    void it("treats control-flow snippets as commented-out code using defaults", () => {
        const comment = createLineComment(" if (player.hp <= 0) return;", "// if (player.hp <= 0) return;");

        const formatted = formatLineComment(comment, DEFAULT_LINE_COMMENT_OPTIONS);

        assert.equal(formatted, "// if (player.hp <= 0) return;");
    });

    void it("ignores unknown option keys and keeps regular line comments", () => {
        const comment = createLineComment(" AUTO-GENERATED FILE - do not edit", "// AUTO-GENERATED FILE - do not edit");

        const formatted = formatLineComment(comment, {
            codeDetectionPatterns: DEFAULT_LINE_COMMENT_OPTIONS.codeDetectionPatterns
        });

        assert.equal(formatted, "// AUTO-GENERATED FILE - do not edit");
    });
});
