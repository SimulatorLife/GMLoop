import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    applySanitizedIndexAdjustments,
    sanitizeConditionalAssignments
} from "../../src/rules/gml/transforms/conditional-assignment-sanitizer.js";

void describe("sanitizeConditionalAssignments", () => {
    void it("duplicates inline assignments in if conditions", () => {
        const input = "if (score = limit) {\n    show_debug_message(score);\n}";
        const result = sanitizeConditionalAssignments(input);
        assert.deepStrictEqual(result, {
            sourceText: "if (score == limit) {\n    show_debug_message(score);\n}",
            indexAdjustments: [11]
        });
    });

    void it("leaves non-conditional assignments unchanged", () => {
        const input = "score = 1;\nif (ready) {\n    score += 1;\n}";
        const result = sanitizeConditionalAssignments(input);
        assert.deepStrictEqual(result, {
            sourceText: input,
            indexAdjustments: null
        });
    });
});

void describe("applySanitizedIndexAdjustments", () => {
    void it("remaps location metadata while ignoring duplicate insertion indices", () => {
        const target = {
            type: "Identifier",
            start: 13,
            end: { index: 20 },
            nested: {
                start: { index: 10 },
                end: 15
            }
        };

        applySanitizedIndexAdjustments(target, [10, 10, 15]);

        assert.deepStrictEqual(target, {
            type: "Identifier",
            start: 12,
            end: { index: 18 },
            nested: {
                start: { index: 10 },
                end: 14
            }
        });
    });
});
