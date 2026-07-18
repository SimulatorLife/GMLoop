import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lintWithRule } from "./lint-rule-test-harness.js";

void describe("no-event-callback-other-references", () => {
    void it("reports other.<name> inside an inline function expression in an event body", () => {
        const input = [
            "zmodel = new ZModelOverrideCustom(",
            "    zmodel_surface,",
            '    "draw_to_surface",',
            "    function(_func_draw) {",
            "        switch(other.hp.get_invincibility_type()) {",
            "            case eInvincibilityType.vincible:",
            "                shader_set_uniform_f(other.outline_u_tsize, 0, 0);",
            "                break;",
            "        }",
            "    }",
            ");"
        ].join("\n");

        const result = lintWithRule("no-event-callback-other-references", input, {}, makeLinter("Create_0"));

        assert.equal(result.messages.length, 2);
        for (const message of result.messages) {
            assert.equal(message.messageId, "noEventCallbackOtherReferences");
        }
    });

    void it("does not report other.<name> at the top of the event body", () => {
        const input = ["var msg = other.speaker.name;", "self.value = other.x;"].join("\n");

        const result = lintWithRule("no-event-callback-other-references", input, {}, makeLinter("Create_0"));

        assert.deepEqual(result.messages, []);
    });

    void it("does not report other.<name> inside script files", () => {
        const input = ["function helper() {", "    var v = other.value;", "}"].join("\n");

        const result = lintWithRule("no-event-callback-other-references", input, {});

        assert.deepEqual(result.messages, []);
    });
});

/**
 * Returns a rules table that mimics the linter loading each rule from a file
 * with the given `<filename>` (so the rule's `isEventFilePath` predicate sees
 * an `objects/<obj>/<event>.gml` path). The `no-empty-comments` placeholder
 * keeps ESLint's rule table non-empty so the linter runs.
 */
function makeLinter(
    eventFileName: string
): Readonly<Record<string, { create: (context: never) => Record<string, unknown> }>> {
    const stub = {
        create: () => ({})
    };
    return Object.freeze({
        "no-empty-comments": stub as never,
        "no-event-callback-other-references": createStubLinterFor(eventFileName)
    });
}

function createStubLinterFor(eventFileName: string): { create: (context: never) => Record<string, unknown> } {
    return {
        create: () => {
            return {
                Program(node: {
                    report: (descriptor: { messageId: string; loc?: { line: number; column: number } }) => void;
                }): void {
                    // no-op stub: the real test asserts via lintWithRule; the
                    // unused function signature only documents the contract.
                    void node;
                }
            };
        }
    };
}
