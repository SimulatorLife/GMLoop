/**
 * Canonical type guards for GML AST nodes are provided by `@gmloop/core`'s
 * `Core` namespace (e.g. `Core.isBinaryExpressionNode`, `Core.isBlockStatementNode`).
 * Import them from there.
 *
 * This file holds a small set of helpers that are **unique** to the transpiler
 * and do not exist in `@gmloop/core`:
 *
 * - `isTemplateStringTextNode` — needed by the emitter's template-string
 *   rendering logic; not exported from `@gmloop/core`.
 *
 * - `isDefaultParameterNode` — needed by the function-arity wrapper in
 *   `gml-transpiler.ts` to distinguish default-parameter nodes from other
 *   parameter forms; `@gmloop/core` has no guard for this type.
 *
 * - `isFunctionScopeBoundary` — a compound guard that checks for
 *   `FunctionDeclaration` | `ConstructorDeclaration`.  These are the only
 *   nodes that create a GML function scope boundary during pre-emission
 *   variable collection.
 *
 * - `isLoopStatement` — a compound guard that checks for the four traditional
 *   iteration constructs (`ForStatement`, `WhileStatement`, `DoUntilStatement`,
 *   `RepeatStatement`).  `WithStatement` is intentionally excluded because its
 *   scope-change semantics differ from pure loops.
 *
 * All other guards (individual node-type predicates) live in `@gmloop/core`.
 *
 * The local `isAstRecord` helper is retained because `local-variable-collector`
 * needs a broad structural predicate (`non-null object`) to drive its generic
 * tree walker, which deliberately does not depend on a typed narrowing guard.
 *
 * NOTE: `@gmloop/core` does not export `isNode` or `TEMPLATE_STRING_TEXT`
 * through its public `Core` namespace.  This module re-imports those symbols
 * internally to implement the unique helpers above.
 */

import { Core } from "@gmloop/core";

const TEMPLATE_STRING_TEXT = "TemplateStringText";
const DEFAULT_PARAMETER = "DefaultParameter";

export function isAstRecord(candidate: unknown): candidate is AstRecord {
    return Core.isNode(candidate);
}

type AstRecord = Record<string, unknown>;

// Guards for node types that are absent from @gmloop/core's public surface.

export function isTemplateStringTextNode(
    candidate: unknown
): candidate is { type: "TemplateStringText"; value: string } & Record<string, unknown> {
    return Core.hasType(candidate, TEMPLATE_STRING_TEXT);
}

export function isDefaultParameterNode(
    candidate: unknown
): candidate is { type: "DefaultParameter"; left: unknown; right?: unknown } & Record<string, unknown> {
    return Core.hasType(candidate, DEFAULT_PARAMETER);
}

// Compound helpers unique to the transpiler, built on top of Core's individual guards.

export function isFunctionScopeBoundary(candidate: unknown): boolean {
    return Core.isFunctionDeclarationNode(candidate) || Core.isConstructorDeclarationNode(candidate);
}

export function isLoopStatement(node: unknown): boolean {
    return (
        Core.isForStatementNode(node) ||
        Core.isWhileStatementNode(node) ||
        Core.isDoUntilStatementNode(node) ||
        Core.isRepeatStatementNode(node)
    );
}
