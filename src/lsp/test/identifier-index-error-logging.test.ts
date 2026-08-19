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
void test("identifier-index.ts logs every error with Core.getErrorMessageOrFallback", async () => {
    const source = await readFile(IDENTIFIER_INDEX_SOURCE_PATH, "utf8");

    // Strip block + line comments so a stray mention inside documentation
    // (e.g. "use Core.getErrorMessageOrFallback") is not mistaken for a
    // call site we need to police.
    const code = source.replaceAll(/\/\*[\s\S]*?\*\//gu, "").replaceAll(/^\s*\/\/.*$/gmu, "");

    const callPattern = /console\.error\s*\(/gu;
    const matches = code.matchAll(callPattern);

    let invocationCount = 0;
    let firstInconsistentLine: { line: number; snippet: string } | null = null;

    for (const match of matches) {
        invocationCount += 1;
        const startOffset = match.index ?? 0;
        // Walk forward to find the matching closing paren for `console.error(`
        // so we are checking the whole invocation, not just the opening.
        let depth = 0;
        let endOffset = -1;
        for (let cursor = startOffset; cursor < code.length; cursor += 1) {
            const character = code[cursor];
            if (character === "(") {
                depth += 1;
            } else if (character === ")") {
                depth -= 1;
                if (depth === 0) {
                    endOffset = cursor;
                    break;
                }
            }
        }

        if (endOffset === -1) {
            continue;
        }

        const invocation = code.slice(startOffset, endOffset + 1);

        // Accept either the interpolated `Core.getErrorMessageOrFallback(error)`
        // form, or a call that wraps it in a back-tick template literal that
        // interpolates the message. The previous anti-pattern was passing the
        // raw `error` as a second positional argument to `console.error`,
        // which we explicitly forbid below.
        const usesMessageExtraction = /Core\.getErrorMessage(?:OrFallback)?\s*\(\s*error\s*\)/u.test(invocation);

        // Detect the legacy anti-pattern: a second positional argument that
        // is the raw error object (or the error captured earlier in scope).
        // `console.error("...", error)` and `console.error(\`...\`, error)`
        // both match; the positive pattern above must override for the cases
        // where the same template literal happens to include the extracted
        // message and also passes the error as a tail argument.
        const rawErrorArgument = /,\s*\berror\b(?!\s*\))/u.test(invocation);

        if (!usesMessageExtraction || rawErrorArgument) {
            const beforeMatch = code.slice(0, startOffset);
            const lineNumber = beforeMatch.split("\n").length;
            firstInconsistentLine = { line: lineNumber, snippet: invocation };
            break;
        }
    }

    assert.ok(invocationCount > 0, "Expected identifier-index.ts to log at least one error via console.error");
    assert.equal(
        firstInconsistentLine,
        null,
        firstInconsistentLine
            ? `Inconsistent console.error at line ${firstInconsistentLine.line}: ${firstInconsistentLine.snippet}\n` +
                  `Every console.error must use Core.getErrorMessageOrFallback(error) and embed it in the log template.`
            : "console.error invocations match the consistent pattern"
    );
});
