/**
 * Lowering logic for GML enum declarations to JavaScript.
 *
 * GML enums are zero-indexed by default with optional explicit initializers.
 * This module provides the transformation that converts a GML enum into
 * JavaScript, preferring a plain object literal and falling back to an IIFE
 * with a running counter only when a member initializer is itself an
 * expression that must be evaluated at runtime.
 */

import type { EnumMemberNode, GmlNode } from "./ast.js";
import { isIdentifierLike, stringifyStructKey } from "./js-string-utils.js";
import { normalizeGmlNumericLiteral } from "./literal-normalization.js";

/**
 * Attempt to fold an enum declaration into a plain object literal at compile
 * time. This is possible whenever every member is either auto-incremented or
 * initialized to a literal that resolves to a finite number, since the whole
 * member/value sequence is then knowable without emitting a runtime counter.
 *
 * Falls back to `null` for enums with string-literal or expression
 * initializers (or non-finite numeric text, e.g. `1_000` separators), so
 * their existing runtime auto-increment semantics — including GML's
 * value-chaining quirks after a non-numeric member — are preserved exactly.
 *
 * @returns The folded `const Name = { ... };` statement, or `null` if any
 * member requires runtime evaluation.
 */
function tryLowerConstantEnum(
    name: string,
    members: ReadonlyArray<EnumMemberNode>,
    resolveEnumMemberName: (member: EnumMemberNode) => string
): string | null {
    const entries: string[] = [];
    let value = -1;

    for (const member of members) {
        const initializer = member.initializer;
        if (initializer !== undefined && initializer !== null) {
            if (typeof initializer !== "string" && typeof initializer !== "number") {
                return null;
            }
            const numeric = Number(normalizeGmlNumericLiteral(String(initializer)));
            if (!Number.isFinite(numeric)) {
                return null;
            }
            value = numeric;
        } else {
            value += 1;
        }
        entries.push(`${stringifyStructKey(resolveEnumMemberName(member))}: ${value}`);
    }

    return `const ${name} = {${entries.length > 0 ? ` ${entries.join(", ")} ` : ""}};`;
}

/**
 * Generate JavaScript code that lowers a GML enum declaration.
 *
 * The generated code creates an immediately-invoked function expression (IIFE)
 * that builds an object with enum member properties. Members without explicit
 * initializers get auto-incremented values starting from 0.
 *
 * @param name - The enum name
 * @param members - The enum members with optional initializers
 * @param visitNode - Function to visit AST nodes (for initializer expressions)
 * @returns JavaScript code implementing the enum
 *
 * @example
 * ```typescript
 * // For: enum Colors { RED, GREEN, BLUE }
 * const code = lowerEnumDeclaration("Colors", [
 *   { name: "RED", initializer: null },
 *   { name: "GREEN", initializer: null },
 *   { name: "BLUE", initializer: null }
 * ], (node) => String(node));
 * // Generates:
 * // const Colors = { RED: 0, GREEN: 1, BLUE: 2 };
 * ```
 */
export function lowerEnumDeclaration(
    name: string,
    members: ReadonlyArray<EnumMemberNode>,
    visitNode: (node: GmlNode) => string,
    resolveEnumMemberName: (member: EnumMemberNode) => string
): string {
    const constantForm = tryLowerConstantEnum(name, members ?? [], resolveEnumMemberName);
    if (constantForm !== null) {
        return constantForm;
    }

    const lines = [`const ${name} = (() => {`, "    const __enum = {};", "    let __value = -1;"];

    for (const member of members ?? []) {
        const memberName = resolveEnumMemberName(member);
        const memberAccess = formatEnumMemberAccess(memberName);
        const initializer = member.initializer;
        if (initializer !== undefined && initializer !== null) {
            const value =
                typeof initializer === "string" || typeof initializer === "number"
                    ? normalizeGmlNumericLiteral(String(initializer))
                    : visitNode(initializer);
            lines.push(`    __value = ${value};`);
        } else {
            lines.push("    __value += 1;");
        }
        lines.push(`    __enum${memberAccess} = __value;`);
    }

    lines.push("    return __enum;", "})();");
    return lines.join("\n");
}

function formatEnumMemberAccess(name: string): string {
    const key = stringifyStructKey(name);
    if (isIdentifierLike(key)) {
        return `.${key}`;
    }
    return `[${key}]`;
}
