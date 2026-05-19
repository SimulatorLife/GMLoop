import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

const { Lint } = LintWorkspace;

/**
 * Helper that builds a minimal mock `CallExpression` AST node as the GML
 * parser would emit it.  The `value` field on `Literal` nodes stores the raw
 * source representation, including the surrounding quote characters.
 */
function buildRealCallNode(calleeName: string, literalValue: string, startIndex = 0): Record<string, unknown> {
    const end = startIndex + calleeName.length + 2 /* parens */ + literalValue.length;
    return {
        type: "CallExpression",
        start: startIndex,
        end,
        object: { type: "Identifier", name: calleeName, start: startIndex, end: startIndex + calleeName.length },
        arguments: [
            {
                type: "Literal",
                value: literalValue,
                start: startIndex + calleeName.length + 1,
                end: end - 1
            }
        ]
    };
}

function createContext(sourceText: string): {
    context: Record<string, unknown>;
    messages: Array<{ messageId: string; fix?: { range: [number, number]; text: string } }>;
} {
    const messages: Array<{ messageId: string; fix?: { range: [number, number]; text: string } }> = [];
    const context = {
        options: [{}],
        sourceCode: { text: sourceText },
        report(descriptor: {
            messageId: string;
            fix?: (fixer: { replaceTextRange: (r: [number, number], t: string) => unknown }) => unknown;
        }) {
            const fixer = {
                replaceTextRange(range: [number, number], text: string) {
                    return { range, text };
                }
            };
            const fix = descriptor.fix?.(fixer) as { range: [number, number]; text: string } | undefined;
            messages.push({ messageId: descriptor.messageId, fix });
        }
    };
    return { context, messages };
}

function runRuleOnNode(
    rule: { create?: unknown },
    source: string,
    node: Record<string, unknown>
): Array<{ messageId: string; fix?: { range: [number, number]; text: string } }> {
    const { context, messages } = createContext(source);
    const create = rule.create as
        | ((context: Record<string, unknown>) => { Program?: (ast: Record<string, unknown>) => void })
        | undefined;
    const visitor = create?.(context);
    visitor?.Program?.({ type: "Program", body: [node] });
    return messages;
}

void describe("gml/simplify-real-calls", () => {
    const rule = Lint.plugin.rules["simplify-real-calls"];

    void it("is registered in the lint plugin", () => {
        assert.ok(rule, "Expected simplify-real-calls rule to be registered");
    });

    const reportingCases = [
        {
            name: "double-quoted numeric string",
            source: 'var x = real("123.45");',
            callee: "real",
            literalValue: '"123.45"',
            expectedFixText: "123.45"
        },
        {
            name: "single-quoted numeric string",
            source: "var x = real('56');",
            callee: "real",
            literalValue: "'56'",
            expectedFixText: "56"
        },
        {
            name: 'verbatim (@") string',
            source: 'var x = real(@"123.45");',
            callee: "real",
            literalValue: '@"123.45"',
            expectedFixText: "123.45"
        },
        {
            name: "uppercase callee (case-insensitive)",
            source: 'var x = REAL("123.45");',
            callee: "REAL",
            literalValue: '"123.45"',
            expectedFixText: "123.45"
        },
        {
            name: "mixed-case callee",
            source: 'var x = ReAl("56");',
            callee: "ReAl",
            literalValue: '"56"',
            expectedFixText: "56"
        }
    ] as const;

    for (const testCase of reportingCases) {
        void it(`reports real() with a ${testCase.name}`, () => {
            const node = buildRealCallNode(testCase.callee, testCase.literalValue, 8);
            const messages = runRuleOnNode(rule, testCase.source, node);

            assert.strictEqual(messages.length, 1);
            assert.strictEqual(messages[0]?.messageId, "simplifyRealCalls");
            assert.strictEqual(messages[0]?.fix?.text, testCase.expectedFixText);
        });
    }

    void it("does not report real() when the argument is a non-numeric string", () => {
        const source = 'var x = real("hello");';
        const node = buildRealCallNode("real", '"hello"', 8);
        const { context, messages } = createContext(source);

        const visitor = rule.create(context as any);
        visitor.Program?.({ type: "Program", body: [node] } as any);

        assert.strictEqual(messages.length, 0);
    });

    void it("does not report real() when the argument is an unquoted numeric literal", () => {
        // real(123.45) — argument is a numeric Literal, not a string
        const source = "var x = real(123.45);";
        const node = {
            type: "CallExpression",
            start: 8,
            end: 21,
            object: { type: "Identifier", name: "real", start: 8, end: 12 },
            arguments: [{ type: "Literal", value: 123.45, start: 13, end: 19 }]
        };
        const { context, messages } = createContext(source);

        const visitor = rule.create(context as any);
        visitor.Program?.({ type: "Program", body: [node] } as any);

        assert.strictEqual(messages.length, 0);
    });

    void it("does not report real() when called with multiple arguments", () => {
        const source = 'var x = real("1", "extra");';
        const node = {
            type: "CallExpression",
            start: 8,
            end: 26,
            object: { type: "Identifier", name: "real", start: 8, end: 12 },
            arguments: [
                { type: "Literal", value: '"1"', start: 13, end: 16 },
                { type: "Literal", value: '"extra"', start: 18, end: 25 }
            ]
        };
        const { context, messages } = createContext(source);

        const visitor = rule.create(context as any);
        visitor.Program?.({ type: "Program", body: [node] } as any);

        assert.strictEqual(messages.length, 0);
    });

    void it("does not report real() when called with no arguments", () => {
        const source = "var x = real();";
        const node = {
            type: "CallExpression",
            start: 8,
            end: 14,
            object: { type: "Identifier", name: "real", start: 8, end: 12 },
            arguments: []
        };
        const { context, messages } = createContext(source);

        const visitor = rule.create(context as any);
        visitor.Program?.({ type: "Program", body: [node] } as any);

        assert.strictEqual(messages.length, 0);
    });

    void it("does not report when the node is not a CallExpression", () => {
        const source = "var real = 0;";
        const node = { type: "Identifier", name: "real", start: 4, end: 8 };
        const { context, messages } = createContext(source);

        const visitor = rule.create(context as any);
        visitor.Program?.({ type: "Program", body: [node] } as any);

        assert.strictEqual(messages.length, 0);
    });

    void it("is included in the recommended config", () => {
        const recommended = Lint.configs.recommended;
        const allRules = recommended.flatMap((config) => Object.keys(config.rules ?? {}));
        assert.ok(
            allRules.includes("gml/simplify-real-calls"),
            "Expected gml/simplify-real-calls to be in the recommended config"
        );
    });
});
