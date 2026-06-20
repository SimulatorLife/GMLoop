import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { lintWithRule } from "./lint-rule-test-harness.js";

const { Lint } = LintWorkspace;

void describe("define directive normalization", () => {
    void it("normalizes #define to #macro while preserving space separator", () => {
        const input = "#define  LEGACY_MACRO 123456789\n";
        const expected = "#macro  LEGACY_MACRO 123456789\n";

        const rule = Lint.plugin.rules["normalize-directives"];
        const messages: Array<{
            messageId: string;
            fix?: Array<{ kind: string; range: [number, number]; text: string }>;
        }> = [];

        const context = {
            options: [{}],
            sourceCode: { text: input },
            report: (descriptor: { messageId: string; fix?: (fixer: any) => any }) => {
                const fixer = {
                    replaceTextRange(range: [number, number], text: string) {
                        return { kind: "replace" as const, range, text };
                    }
                };
                const fix = descriptor.fix?.(fixer);
                messages.push({
                    messageId: descriptor.messageId,
                    fix: fix ? (Array.isArray(fix) ? fix : [fix]) : undefined
                });
            }
        };

        const visitor = rule.create(context as any);
        visitor.Program?.({ type: "Program", body: [] } as any);

        assert.strictEqual(messages.length, 1);
        assert.strictEqual(messages[0]?.messageId, "normalizeDirectives");
        assert.strictEqual(messages[0]?.fix?.[0]?.text, expected);
    });

    void it("drops invalid legacy defines while normalizing regions and begin-end blocks", () => {
        const input = [
            "#define region Utility Scripts",
            "#define end region Utility Scripts",
            "//#region Setup",
            "//#endregion",
            "#define 123 not valid",
            "if (ready) begin",
            "    do_work();",
            "end // done",
            "begin;",
            "    nested += 1;",
            "end;",
            ""
        ].join("\n");
        const expected = [
            "#region Utility Scripts",
            "#endregion Utility Scripts",
            "//#region Setup",
            "//#endregion",
            "",
            "if (ready) {",
            "    do_work();",
            "} // done",
            "",
            "    nested += 1;",
            ""
        ].join("\n");

        const result = lintWithRule("normalize-directives", input, {});

        assert.strictEqual(result.output, expected);
    });

    void it("drops standalone begin-end wrappers while preserving a single separating blank line", () => {
        const input = ["begin;", "    nested += 1;", "end;", ""].join("\n");
        const expected = ["", "    nested += 1;", ""].join("\n");

        const result = lintWithRule("normalize-directives", input, {});

        assert.strictEqual(result.output, expected);
    });

    void it("removes trailing semicolons from normalized legacy macros while preserving comments", () => {
        const input = ["#define BAR 2; // keep comment", ""].join("\n");
        const expected = ["#macro BAR 2 // keep comment", ""].join("\n");

        const result = lintWithRule("normalize-directives", input, {});

        assert.strictEqual(result.output, expected);
    });

    void it("preserves inline // inside strings while still capturing trailing comments", () => {
        const input = ['#define MSG "https://gmloop.dev" // keep comment', ""].join("\n");
        const expected = ['#macro MSG "https://gmloop.dev" // keep comment', ""].join("\n");

        const result = lintWithRule("normalize-directives", input, {});

        assert.strictEqual(result.output, expected);
    });
});
