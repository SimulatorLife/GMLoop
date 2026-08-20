import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const REPOSITORY_ROOT = path.resolve(new URL("../../../../", import.meta.url).pathname);
const IDENTIFIER_INDEX_SOURCE_PATH = path.join(REPOSITORY_ROOT, "src/lsp/src/intelligence/identifier-index.ts");

/**
 * Source-level pinning test for the error-logging contract in
 * `identifier-index.ts`.
 *
 * The file used to mix two patterns for background failure reporting:
 *
 *   1. `console.error(\`Label: ${Core.getErrorMessageOrFallback(error)}\`)` —
 *      extracts the error's message into the log line.
 *   2. `console.error("Label:", error)` — passes the raw error object as a
 *      second argument, which produces a different stderr shape (depending on
 *      Node.js version) and is harder to grep in CI logs.
 *
 * This test reads the source and asserts every `console.error` invocation
 * inside `identifier-index.ts` follows pattern (1). Adding a new
 * `console.error` call must therefore interpolate
 * `Core.getErrorMessageOrFallback(error)` (or an equivalent string
 * extraction) into the message template; otherwise the test fails and the
 * inconsistency returns.
 */
type InvocationSpan = { readonly start: number; readonly end: number; readonly text: string };

const INVOCATION_MESSAGE_PATTERN = /Core\.getErrorMessage(?:OrFallback)?\s*\(\s*error\s*\)/u;
const INVOCATION_RAW_ERROR_PATTERN = /,\s*\berror\b(?!\s*\))/u;
const COMMENT_BLOCK_PATTERN = /\/\*[\s\S]*?\*\//gu;
const COMMENT_LINE_PATTERN = /^\s*\/\/.*$/gmu;
const CONSOLE_ERROR_OPEN_PATTERN = /console\.error\s*\(/gu;

function stripComments(source: string): string {
    return source.replaceAll(COMMENT_BLOCK_PATTERN, "").replaceAll(COMMENT_LINE_PATTERN, "");
}

function findMatchingCloseParen(code: string, openParenOffset: number): number {
    let depth = 0;
    for (let cursor = openParenOffset; cursor < code.length; cursor += 1) {
        const character = code[cursor];
        if (character === "(") {
            depth += 1;
        } else if (character === ")") {
            depth -= 1;
            if (depth === 0) {
                return cursor;
            }
        }
    }
    return -1;
}

function extractInvocation(code: string, openParenOffset: number): InvocationSpan | null {
    const endOffset = findMatchingCloseParen(code, openParenOffset);
    if (endOffset === -1) {
        return null;
    }
    return { start: openParenOffset, end: endOffset, text: code.slice(openParenOffset, endOffset + 1) };
}

function invocationsFollowErrorMessageContract(code: string): {
    readonly invocationCount: number;
    readonly firstInconsistency: { line: number; snippet: string } | null;
} {
    let invocationCount = 0;
    let firstInconsistency: { line: number; snippet: string } | null = null;

    for (const match of code.matchAll(CONSOLE_ERROR_OPEN_PATTERN)) {
        const openParenOffset = match.index ?? 0;
        const invocation = extractInvocation(code, openParenOffset);
        if (invocation === null) {
            continue;
        }
        invocationCount += 1;
        if (invocationViolatesContract(invocation.text)) {
            firstInconsistency = {
                line: code.slice(0, invocation.start).split("\n").length,
                snippet: invocation.text
            };
            break;
        }
    }

    return { invocationCount, firstInconsistency };
}

function invocationViolatesContract(invocation: string): boolean {
    // Accept the interpolated `Core.getErrorMessageOrFallback(error)` form, or
    // any call that wraps the extracted message in the log template. The
    // legacy anti-pattern was passing the raw `error` as a second positional
    // argument to `console.error`, which produced a different stderr shape
    // and is harder to grep in CI logs.
    return !INVOCATION_MESSAGE_PATTERN.test(invocation) || INVOCATION_RAW_ERROR_PATTERN.test(invocation);
}

void test("identifier-index.ts logs every error with Core.getErrorMessageOrFallback", async () => {
    const source = await readFile(IDENTIFIER_INDEX_SOURCE_PATH, "utf8");
    const code = stripComments(source);
    const { invocationCount, firstInconsistency } = invocationsFollowErrorMessageContract(code);

    assert.ok(invocationCount > 0, "Expected identifier-index.ts to log at least one error via console.error");
    assert.equal(
        firstInconsistency,
        null,
        firstInconsistency
            ? `Inconsistent console.error at line ${firstInconsistency.line}: ${firstInconsistency.snippet}\n` +
                  `Every console.error must use Core.getErrorMessageOrFallback(error) and embed it in the log template.`
            : "console.error invocations match the consistent pattern"
    );
});
