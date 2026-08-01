import { sym } from "./scip.js";
import type { SemKind } from "./sem-oracle.js";

/**
 * Build a qualified SCIP symbol for an identifier based on its semantic kind.
 *
 * Maps semantic classification to SCIP symbol URIs:
 * - `script`      → `gml/script/{name}`
 * - `global_field` → `gml/var/global::{name}`
 * - `builtin`     → `gml/macro/{name}`
 * - Other kinds   → `null` (local/self/other don't warrant project-scoped symbols)
 *
 * @param kind Semantic kind of the identifier.
 * @param name Identifier name.
 * @returns Qualified symbol string or null for non-project-scoped kinds.
 */
export function buildQualifiedSymbol(kind: SemKind, name: string): string | null {
    if (kind === "script") {
        return sym("script", name);
    }
    if (kind === "global_field") {
        return sym("var", `global::${name}`);
    }
    if (kind === "builtin") {
        return sym("macro", name);
    }
    return null;
}

/**
 * Build a qualified SCIP symbol for a call target (script or builtin).
 *
 * Maps call target classification to SCIP symbol URIs:
 * - `script`  → `gml/script/{name}`
 * - `builtin` → `gml/macro/{name}`
 * - Other     → `null`
 *
 * @param kind Call target kind ("script" or "builtin").
 * @param name Identifier name.
 * @returns Symbol string or null for unknown targets.
 */
export function buildCallTargetSymbol(kind: "script" | "builtin", name: string): string | null {
    if (kind === "script") {
        return sym("script", name);
    }
    if (kind === "builtin") {
        return sym("macro", name);
    }
    return null;
}
