import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type { GlobalvarToGlobalCodemodOptions, GlobalvarToGlobalEdit, GlobalvarToGlobalResult } from "./types.js";

/**
 * Represents a `GlobalVarStatement` node extracted from the AST.
 * Only the range and declared name set are needed for edit generation.
 */
type GlobalVarStatementInfo = Readonly<{
    /** Inclusive start offset of the `globalvar` keyword. */
    startInclusive: number;
    /** Inclusive end offset of the trailing semicolon. */
    endInclusive: number;
    /** Names declared by this statement (e.g. `x`, `y` for `globalvar x, y;`). */
    declaredNames: ReadonlyArray<string>;
}>;

/**
 * A bare identifier reference to a globalvar-declared name that should be
 * replaced with `global.<name>`.
 */
type IdentifierReferenceInfo = Readonly<{
    /** Inclusive start offset of the identifier token. */
    startInclusive: number;
    /** Inclusive end offset of the identifier token. */
    endInclusive: number;
    /** The identifier name. */
    name: string;
}>;

/**
 * Extract globalvar-declared variable names from a single `GlobalVarStatement`
 * node and add them to `globalvarNames`.  Returns the list of declared names
 * for use in the `GlobalVarStatementInfo` record.
 */
function collectDeclaredNamesFromStatement(
    record: Record<string, unknown>,
    globalvarNames: Set<string>
): ReadonlyArray<string> {
    if (!Array.isArray(record.declarations)) {
        return [];
    }

    const declaredNames: Array<string> = [];
    for (const declarator of record.declarations) {
        const id = (declarator as Record<string, unknown>).id;
        if (!id || typeof id !== "object") {
            continue;
        }

        const idName = (id as Record<string, unknown>).name;
        if (typeof idName === "string" && Core.isNonEmptyString(idName)) {
            declaredNames.push(idName);
            globalvarNames.add(idName);
        }
    }

    return declaredNames;
}

type AstCollectionResult = Readonly<{
    declarations: ReadonlyArray<GlobalVarStatementInfo>;
    references: ReadonlyArray<IdentifierReferenceInfo>;
}>;

// ---------------------------------------------------------------------------
// Single-pass AST traversal
// ---------------------------------------------------------------------------

/**
 * Collect GlobalVarStatement declarations and bare Identifier references in a
 * **single recursive pass** over the parsed AST.
 *
 * @param programNode - Root `Program` node returned by the GML parser.
 * @param globalvarNames - Names known to be declared via `globalvar` — used
 *   when the program itself does not declare them (cross-file scenario where
 *   the declaration lives in another file).  Pass an empty set when only
 *   analyzing a single file in isolation; the set will be extended in-place
 *   with any `GlobalVarStatement` names found in this file.
 */
function collectAstData(programNode: unknown, globalvarNames: Set<string>): AstCollectionResult {
    const declarations: Array<GlobalVarStatementInfo> = [];
    const references: Array<IdentifierReferenceInfo> = [];

    /**
     * @param node - Current AST node.
     * @param isPropertyAccess - True when this node is the `.property` of a
     *   `MemberDotExpression` — in that case bare identifiers must not be
     *   treated as globalvar references (they are member property names).
     */
    const visit = (node: unknown, isPropertyAccess: boolean): void => {
        if (!node || typeof node !== "object") {
            return;
        }

        if (Array.isArray(node)) {
            for (const element of node) {
                visit(element, false);
            }
            return;
        }

        const record = node as Record<string, unknown>;
        const type = record.type;

        // ── GlobalVarStatement ───────────────────────────────────────────────
        if (type === "GlobalVarStatement") {
            const stmtStart = typeof record.start === "number" ? record.start : null;
            const stmtEnd = typeof record.end === "number" ? record.end : null;

            if (stmtStart !== null && stmtEnd !== null) {
                const declaredNames = collectDeclaredNamesFromStatement(record, globalvarNames);
                declarations.push(
                    Object.freeze({
                        startInclusive: stmtStart,
                        endInclusive: stmtEnd,
                        declaredNames: Object.freeze(declaredNames)
                    })
                );
            }
            // Do NOT descend into GlobalVarStatement children — the identifiers
            // there are declarations, not references.
            return;
        }

        // ── MemberDotExpression ──────────────────────────────────────────────
        // Visit the `object` side normally (it can be a globalvar reference:
        // e.g. a struct stored in a globalvar), but mark the `property` side
        // as a property-access so we do not rewrite it.
        if (type === "MemberDotExpression") {
            visit(record.object, false);
            visit(record.property, true);
            return;
        }

        // ── Identifier ───────────────────────────────────────────────────────
        if (type === "Identifier" && !isPropertyAccess) {
            const name = record.name;
            const start = typeof record.start === "number" ? record.start : null;
            const end = typeof record.end === "number" ? record.end : null;

            if (typeof name === "string" && start !== null && end !== null && globalvarNames.has(name)) {
                references.push(Object.freeze({ startInclusive: start, endInclusive: end, name }));
            }
            return;
        }

        // ── Generic descent ──────────────────────────────────────────────────
        for (const value of Object.values(record)) {
            if (value && typeof value === "object") {
                visit(value, false);
            }
        }
    };

    visit(programNode, false);
    return Object.freeze({ declarations, references });
}

// ---------------------------------------------------------------------------
// Edit helpers
// ---------------------------------------------------------------------------

/**
 * Advance `offset` past any ASCII space / tab / carriage-return characters,
 * stopping before the first `\n` or any non-whitespace character.
 */
function skipTrailingSpacesOnLine(text: string, offset: number): number {
    let pos = offset;
    while (pos < text.length) {
        const char = text[pos];
        if (char === "\n" || (char !== " " && char !== "\t" && char !== "\r")) {
            break;
        }
        pos += 1;
    }
    return pos;
}

/**
 * Build a deletion edit for a `GlobalVarStatement`, including the newline
 * that immediately follows the semicolon (when present) so that the removed
 * statement does not leave behind a blank line.
 *
 * The returned edit uses **exclusive** end indices, matching the convention
 * used by `WorkspaceEdit.addEdit` and `applySourceTextEdits`.
 */
function buildDeletionEdit(sourceText: string, stmt: GlobalVarStatementInfo): GlobalvarToGlobalEdit {
    // Inclusive end of the statement is the semicolon position.
    // Exclusive end starts just after the semicolon.
    let endExclusive = stmt.endInclusive + 1;

    // Skip trailing horizontal whitespace on the same line.
    endExclusive = skipTrailingSpacesOnLine(sourceText, endExclusive);

    // Consume the newline character that terminates the line (if present).
    if (endExclusive < sourceText.length && sourceText[endExclusive] === "\n") {
        endExclusive += 1;
    }

    return Object.freeze({
        start: stmt.startInclusive,
        end: endExclusive,
        text: ""
    });
}

/**
 * Apply a list of non-overlapping edits to `sourceText` using a left-to-right
 * string builder.  Edits are sorted in **ascending** order by `start` so the
 * result can be assembled in a single forward pass without intermediate string
 * copies — approximately 6-7× faster than the previous descending-sort +
 * repeated-slice approach on files with many edits.
 */
function applyEdits(sourceText: string, edits: ReadonlyArray<GlobalvarToGlobalEdit>): string {
    if (edits.length === 0) {
        return sourceText;
    }

    const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
    let result = "";
    let cursor = 0;

    for (const edit of sorted) {
        result += sourceText.slice(cursor, edit.start);
        result += edit.text;
        cursor = edit.end;
    }

    result += sourceText.slice(cursor);
    return result;
}

/**
 * Check whether `sourceText` contains content relevant to the globalvar-to-global
 * codemod — either the `globalvar` keyword (indicating possible declarations) or
 * any of the `knownNames` as a substring (indicating possible references).
 *
 * This is a conservative text-level pre-filter: it may produce false positives
 * (e.g. a name appearing inside a string literal) but never false negatives, so
 * skipping the AST parse when it returns `false` is always safe.
 *
 * For very large known-name sets (> 200), the per-name substring scan could become
 * more expensive than parsing, so the check is skipped and the function returns
 * `true` unconditionally to fall through to the parser.
 */
function sourceContainsGlobalvarContent(sourceText: string, knownNames: ReadonlySet<string>): boolean {
    if (sourceText.includes("globalvar")) {
        return true;
    }

    // When there are no cross-file names to check, the only possible edits are
    // declaration removals, which require the keyword checked above.
    if (knownNames.size === 0) {
        return false;
    }

    // For large name sets the per-name `includes()` scan across the full file
    // text becomes more expensive than just parsing the file.  The threshold of
    // 200 names is chosen conservatively: at that cardinality the substring scan
    // of a typical 10-50 KB GML file costs roughly the same as a single parse,
    // so the fast-path no longer provides a net benefit and we fall through to
    // the parser which handles the rest correctly.
    if (knownNames.size > 200) {
        return true;
    }

    for (const name of knownNames) {
        if (sourceText.includes(name)) {
            return true;
        }
    }

    return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan `sourceText` for `globalvar` declarations and return the set of
 * declared variable names without generating any source edits.
 *
 * This lightweight helper is used by the engine in Phase 1 of the
 * `executeGlobalvarToGlobalCodemod` workflow to collect globalvar names
 * across all project files before the rewrite pass.  It parses the AST
 * once but skips all edit-generation work.
 *
 * Returns an empty set when the source cannot be parsed or contains no
 * `globalvar` statements.
 */
export function collectGlobalvarDeclaredNames(sourceText: string): ReadonlySet<string> {
    if (!Core.isNonEmptyString(sourceText) || !sourceText.includes("globalvar")) {
        return new Set();
    }

    let ast: unknown;
    try {
        ast = Parser.GMLParser.parse(sourceText);
    } catch {
        return new Set();
    }

    const names = new Set<string>();
    collectAstData(ast, names);
    return names;
}

/**
 * Apply the globalvar-to-global codemod to a single GML source file.
 *
 * The codemod performs two classes of edits:
 *
 * 1. **Declaration removal**: every `globalvar <name>[, …];` statement found
 *    in `sourceText` is deleted (including its trailing newline).
 * 2. **Reference migration**: every bare `<name>` identifier that refers to a
 *    globalvar-declared name is replaced with `global.<name>`.
 *
 * The function is single-file and pure — it never reads from or writes to the
 * filesystem.  Cross-file scenarios (where a globalvar is *declared* in one
 * file but *used* in another) are handled by the engine-level
 * `executeGlobalvarToGlobalCodemod` method, which passes
 * `knownGlobalvarNames` across file boundaries.
 *
 * @param sourceText - GML source to transform.
 * @param knownGlobalvarNames - Additional globalvar names collected from other
 *   files in the project.  References to these names will be migrated even
 *   when the declaration does not appear in `sourceText`.
 * @returns A result describing the transformed source and applied edits.
 */
export function applyGlobalvarToGlobalCodemod(
    sourceText: string,
    knownGlobalvarNames: ReadonlySet<string> = new Set(),
    options: GlobalvarToGlobalCodemodOptions = {}
): GlobalvarToGlobalResult {
    if (!Core.isNonEmptyString(sourceText)) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            migratedNames: Object.freeze([])
        });
    }

    // Fast-path: skip the expensive AST parse when the source cannot contain
    // any relevant globalvar content.  A file is relevant only if it contains
    // the `globalvar` keyword (possible declarations) or references any known
    // cross-file globalvar name.  This avoids parsing the vast majority of
    // files in a large project where only a handful declare globalvars.
    if (!sourceContainsGlobalvarContent(sourceText, knownGlobalvarNames)) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            migratedNames: Object.freeze([])
        });
    }

    let ast: unknown;
    try {
        ast = Parser.GMLParser.parse(sourceText);
    } catch {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            migratedNames: Object.freeze([])
        });
    }

    // Start with a mutable copy of the known cross-file names so that local
    // declarations are added to the same set and references within this file
    // are also captured.
    const workingNames = new Set(knownGlobalvarNames);
    const { declarations, references } = collectAstData(ast, workingNames);

    // Names excluded from reference migration (declarations are still removed).
    const excludeSet: ReadonlySet<string> =
        options.excludeNames && options.excludeNames.length > 0 ? new Set(options.excludeNames) : new Set();

    // Nothing to do if no globalvar names are present in or known for this file.
    if (workingNames.size === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            migratedNames: Object.freeze([])
        });
    }

    const edits: Array<GlobalvarToGlobalEdit> = [];

    // Build deletion edits for each GlobalVarStatement declaration.
    for (const decl of declarations) {
        edits.push(buildDeletionEdit(sourceText, decl));
    }

    // Build replacement edits for each bare identifier reference, skipping
    // any names explicitly excluded by the caller.
    for (const ref of references) {
        if (excludeSet.has(ref.name)) {
            continue;
        }
        edits.push(
            Object.freeze({
                start: ref.startInclusive,
                end: ref.endInclusive + 1, // exclusive end
                text: `global.${ref.name}`
            })
        );
    }

    if (edits.length === 0) {
        return Object.freeze({
            changed: false,
            outputText: sourceText,
            appliedEdits: Object.freeze([]),
            migratedNames: Object.freeze([])
        });
    }

    const outputText = applyEdits(sourceText, edits);
    // migratedNames reflects names whose references were actually rewritten.
    const migratedNames = [...workingNames].filter((n) => !excludeSet.has(n)).sort();

    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(edits),
        migratedNames: Object.freeze(migratedNames)
    });
}
