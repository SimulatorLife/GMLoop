/**
 * Block keywords that, when they start a statement, signal that the preceding
 * statement on the same line is terminated even without an explicit semicolon.
 * Does not include `else` or `case` because those are line continuations.
 */
const STATEMENT_TERMINATION_KEYWORDS = Object.freeze(["if", "for", "while", "switch", "try", "with", "do"]);

/**
 * Predicates whether an emitted code fragment already ends with a statement
 * terminator and therefore does not need a trailing semicolon.
 *
 * A statement is considered terminated when it:
 * - Ends with `;` or `}`
 * - Starts with a block-keyword (`if`, `for`, `while`, `switch`, `try`, `with`, `do`)
 *   after collapsing leading whitespace (so a comment followed by `if` is detected)
 *
 * Two separate trims are used intentionally:
 * - `trimEnd` is checked first against `;`/`}` so that a line with trailing space
 *   (e.g. `"foo();  "`) is recognized as terminated without collapsing that space.
 * - `trimStart` is then used for the keyword check so that inline comments or
 *   leading whitespace before a block keyword do not prevent detection.
 *
 * @param code - The emitted code fragment to inspect
 * @returns true if the fragment already terminates a statement
 */
export function isStatementTerminated(code: string): boolean {
    const trimmedEnd = code.trimEnd();
    const trimmed = code.trimStart();

    return (
        trimmedEnd.endsWith(";") ||
        trimmedEnd.endsWith("}") ||
        STATEMENT_TERMINATION_KEYWORDS.some((keyword) => trimmed.startsWith(keyword))
    );
}

/**
 * Appends a trailing semicolon when the given code fragment is not already
 * terminated.
 *
 * This is the single call site for semicolon insertion in the emitter, keeping
 * the termination logic centralized and easier to reason about.
 *
 * @param code - The emitted code fragment to potentially terminate
 * @returns The fragment with a semicolon appended if needed; empty strings pass
 *          through unchanged to avoid producing a lone `;`
 */
export function ensureStatementTerminated(code: string): string {
    if (!code) {
        return code;
    }

    return isStatementTerminated(code) ? code : `${code};`;
}
