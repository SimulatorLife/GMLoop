import assert from "node:assert/strict";
import test from "node:test";

import { Core, type MutableDocCommentLines } from "../../index.js";

void test("collectDescriptionContinuationText normalizes multiline description payloads with consumed-line metadata", () => {
    const docLines = [
        "    /// @description Build the packet",
        "    /// first line",
        "    ///   nested details",
        "    ///",
        "    /// @param value"
    ];

    const { prefix } = Core.resolveDescriptionIndentation(docLines[0]);
    const result = Core.collectDescriptionContinuationText(docLines, 0, Math.max(prefix.length - 3, 0));

    assert.deepStrictEqual(result, {
        continuations: ["first line", "nested details", ""],
        linesConsumed: 4
    });
});

void test("description continuation helpers reuse the same description anchor lookup", () => {
    const docLines: MutableDocCommentLines = [
        "/// @description Build the packet",
        "/// first line",
        "/// @param value"
    ];

    assert.deepStrictEqual(Core.collectDescriptionContinuations(docLines), ["/// first line"]);

    const applied = Core.applyDescriptionContinuations(docLines, ["/// second line"]);
    // Content must match the expected insertion order.
    assert.deepStrictEqual(Array.from(applied), [
        "/// @description Build the packet",
        "/// second line",
        "/// first line",
        "/// @param value"
    ]);
    // applyDescriptionContinuations sets _preserveDescriptionBreaks to signal
    // that the manual line breaks should be kept during later formatting.
    assert.strictEqual(applied._preserveDescriptionBreaks, true);

    Core.ensureDescriptionContinuations(docLines);
    assert.deepStrictEqual(Array.from(docLines), [
        "/// @description Build the packet",
        "/// second line",
        "/// first line",
        "/// @param value"
    ]);
    // ensureDescriptionContinuations also sets the flag when continuations
    // are present and have been normalised.
    assert.strictEqual(docLines._preserveDescriptionBreaks, true);
});
