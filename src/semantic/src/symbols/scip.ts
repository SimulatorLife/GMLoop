/**
 * SCIP (Sourcegraph Code Intelligence Protocol) primitives for GML symbols.
 *
 * Combines symbol-string construction and occurrence-role constants into a
 * single module so callers have one import site for all SCIP helpers.
 */

/** Discriminated kind tag used in SCIP symbol URIs. */
export type GmlSymbolKind = "script" | "event" | "object" | "macro" | "enum" | "var";

/**
 * Create a stable SCIP symbol string for a GML symbol.
 *
 * @param kind  Symbol kind tag (e.g. `"script"`, `"var"`).
 * @param name  Unqualified symbol name.
 * @returns A URI-like identifier such as `gml/script/scr_damage_enemy`.
 */
export function sym(kind: GmlSymbolKind, name: string): string {
    return `gml/${kind}/${name}`;
}

// ---------------------------------------------------------------------------
// Occurrence-role constants
// Range tuple layout: [startLine, startCol, endLine, endCol]
// ---------------------------------------------------------------------------

/** SCIP role constant for a definition occurrence. */
export const ROLE_DEF = 1;

/** SCIP role constant for a reference occurrence. */
export const ROLE_REF = 0;
