/**
 * Printer utilities for variable declarator layout in the GML formatter.
 *
 * This module is responsible for formatter-owned doc-layout operations:
 *
 * - Joining an array of declarator doc fragments with ", " separators
 *   for `VariableDeclaration` nodes in the printer.
 *
 * Path traversal helpers (e.g. `findEnclosingFunctionDeclaration`) have been
 * moved to `path-utils.ts`, which is the canonical home for AstPath utilities.
 *
 * All semantic/content rewrites (parameter renaming from `@function` tags,
 * filtering redundant `argument0`-style alias declarations) belong in
 * `@gmloop/lint`, not in the formatter. See target-state.md §2.2 and §3.2.
 *
 * ## Enforced Boundary — `filterMisattachedFunctionDocComments` was removed
 *
 * A function previously named `filterMisattachedFunctionDocComments` was
 * deleted from this module. It was a parser-workaround that repaired
 * misattached `@function`/`@func` doc-comment attachments directly inside the
 * formatter. Normalizing comment-to-node attachment is the parser's
 * responsibility (see `normalize-function-doc-comment-attachments.ts` in
 * `@gmloop/core`). The formatter must never attempt to repair AST
 * comment attachment—if the parser delivers misattached comments, the
 * parser pass must fix them upstream. (target-state.md §2.2, §3.2)
 *
 * Exported symbols are consumed by the printer (`print.ts`).
 */

/**
 * Joins an array of declarator doc fragments with comma separators.
 *
 * Inserts ", " between each pair of elements to produce a comma-separated list
 * suitable for variable declarations.
 *
 * @param parts - Array of doc fragments to join
 * @returns Flat array with commas inserted between parts
 */
export function joinDeclaratorPartsWithCommas(parts: unknown[]): unknown[] {
    const joined: unknown[] = [];
    const count = parts.length;

    for (let i = 0; i < count; i += 1) {
        joined.push(parts[i]);

        if (i < count - 1) {
            joined.push(", ");
        }
    }

    return joined;
}
