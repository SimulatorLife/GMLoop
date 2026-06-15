import { Parser } from "@gmloop/parser";

/**
 * Represents a fixer operation that replaces a text range with new text.
 */
export type ReplaceTextRangeFixOperation = {
    kind: "replace";
    range: [number, number];
    text: string;
};

/**
 * Represents a fixer operation that inserts text immediately after a range.
 */
export type InsertTextAfterRangeFixOperation = {
    kind: "insert-after";
    range: [number, number];
    text: string;
};

/**
 * Union of supported local test fixer operations.
 */
export type RuleTestFixOperation = ReplaceTextRangeFixOperation | InsertTextAfterRangeFixOperation;

type AstNodeWithOptionalRange = Readonly<{
    range?: readonly [number, number];
    start?: number | { index?: number };
    end?: number | { index?: number };
}>;

function buildLineStarts(text: string): Array<number> {
    const starts = [0];
    for (const [index, character] of Array.from(text).entries()) {
        if (character === "\n") {
            starts.push(index + 1);
        }
    }
    return starts;
}

/**
 * Creates a location resolver that maps absolute indexes to line/column pairs.
 */
export function createLocResolver(text: string): (index: number) => { line: number; column: number } {
    const lineStarts = buildLineStarts(text);

    return (index: number) => {
        let line = 0;
        for (const [candidate, lineStart] of lineStarts.entries()) {
            if (lineStart > index) {
                break;
            }

            line = candidate;
        }

        return { line: line + 1, column: index - lineStarts[line] };
    };
}

/**
 * Applies a set of local test fixer operations in source-order.
 */
export function applyFixOperations(text: string, operations: Array<RuleTestFixOperation>): string {
    const ordered = [...operations].sort((left, right) => {
        if (left.range[0] !== right.range[0]) {
            return left.range[0] - right.range[0];
        }
        if (left.range[1] !== right.range[1]) {
            return left.range[1] - right.range[1];
        }
        return left.kind.localeCompare(right.kind);
    });
    let output = "";
    let cursor = 0;
    const appliedKeys = new Set<string>();
    for (const operation of ordered) {
        const [start, end] = operation.range;
        const operationKey = `${operation.kind}:${start}:${end}:${operation.text}`;
        if (appliedKeys.has(operationKey)) {
            continue;
        }
        appliedKeys.add(operationKey);

        const anchorStart = operation.kind === "insert-after" ? end : start;
        // ESLint fix application ignores edits that overlap previously applied edits.
        // Mirror that behavior so tests match real fixer execution.
        if (anchorStart < cursor) {
            continue;
        }

        output += text.slice(cursor, operation.kind === "insert-after" ? end : start);
        output += operation.text;
        cursor = operation.kind === "replace" || operation.kind === "insert-after" ? end : start;
    }

    output += text.slice(cursor);
    return output;
}

function readNodeBoundaryIndex(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (value && typeof value === "object") {
        const index = Reflect.get(value, "index");
        if (typeof index === "number" && Number.isFinite(index)) {
            return index;
        }
    }

    return null;
}

/**
 * Reads a stable `[start, end]` text range for a parsed AST node.
 */
export function readNodeTextRange(node: unknown): [number, number] | null {
    if (!node || typeof node !== "object") {
        return null;
    }

    const candidate = node as AstNodeWithOptionalRange;
    if (Array.isArray(candidate.range) && candidate.range.length === 2) {
        const [start, end] = candidate.range;
        if (typeof start === "number" && Number.isFinite(start) && typeof end === "number" && Number.isFinite(end)) {
            return [start, end];
        }
    }

    const start = readNodeBoundaryIndex(candidate.start);
    const end = readNodeBoundaryIndex(candidate.end);
    if (start === null || end === null) {
        return null;
    }

    return [start, end];
}

/**
 * Type representing a lint plugin with rules.
 */
type LintPlugin = {
    rules: Record<string, { create: (context: never) => { Program?: (node: never) => void } }>;
};

function parseFeatherRuleProgram(code: string): object {
    try {
        return new Parser.GMLParser(code, {
            astFormat: "gml",
            asJSON: false,
            getComments: true,
            getLocations: true,
            simplifyLocations: false
        }).parse();
    } catch {
        return Object.freeze({ type: "Program" });
    }
}

/**
 * Runs a feather rule against code and returns the messages and fixed output.
 * This is a shared test helper for testing feather lint rules.
 */
export function lintWithFeatherRule(
    plugin: LintPlugin,
    ruleName: string,
    code: string
): { messages: Array<{ messageId: string }>; output: string } {
    const rule = plugin.rules[ruleName];
    const messages: Array<{ messageId: string; fix?: ReplaceTextRangeFixOperation }> = [];
    const getLocFromIndex = createLocResolver(code);

    const context = {
        options: [{}],
        sourceCode: {
            text: code,
            getLocFromIndex
        },
        report(payload: {
            messageId: string;
            fix?: (fixer: {
                replaceTextRange(range: [number, number], text: string): ReplaceTextRangeFixOperation;
            }) => ReplaceTextRangeFixOperation | null;
        }) {
            const fixer = {
                replaceTextRange(range: [number, number], text: string): ReplaceTextRangeFixOperation {
                    return { kind: "replace", range, text };
                }
            };
            messages.push({
                messageId: payload.messageId,
                fix: payload.fix ? (payload.fix(fixer) ?? undefined) : undefined
            });
        }
    } as never;

    const listeners = rule.create(context);
    listeners.Program?.(parseFeatherRuleProgram(code) as never);

    const output = applyFixOperations(
        code,
        messages.map((message) => message.fix).filter((fix): fix is ReplaceTextRangeFixOperation => fix !== undefined)
    );

    return {
        messages: messages.map((message) => ({ messageId: message.messageId })),
        output
    };
}

/**
 * Runs a GML lint rule against source text and returns a message count plus the
 * auto-fixed output. The rule's `Program` visitor is called with the provided
 * `programNode`.
 *
 * This is the canonical helper for the simple `run<Rule>(code)` pattern used
 * across single-rule test files and eliminates per-file context boilerplate.
 */
export function runGmlRule(parameters: {
    rule: { create: (context: never) => { Program?: (node: never) => void } };
    code: string;
    programNode: Record<string, unknown>;
}): { messageCount: number; output: string } {
    const fixes: Array<ReplaceTextRangeFixOperation> = [];
    let messageCount = 0;
    const getLocFromIndex = createLocResolver(parameters.code);

    const context = {
        options: [{}],
        sourceCode: {
            text: parameters.code,
            getLocFromIndex
        },
        report(payload: {
            fix?: (fixer: {
                replaceTextRange(range: [number, number], text: string): ReplaceTextRangeFixOperation;
            }) => ReplaceTextRangeFixOperation | null;
        }) {
            messageCount += 1;

            if (!payload.fix) {
                return;
            }

            const fixer = {
                replaceTextRange(range: [number, number], text: string): ReplaceTextRangeFixOperation {
                    return { kind: "replace", range, text };
                }
            };

            const fix = payload.fix(fixer);
            if (fix) {
                fixes.push(fix);
            }
        }
    } as never;

    const listeners = parameters.rule.create(context);
    listeners.Program?.(parameters.programNode as never);

    return {
        messageCount,
        output: applyFixOperations(parameters.code, fixes)
    };
}
