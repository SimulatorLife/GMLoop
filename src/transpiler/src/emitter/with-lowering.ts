/**
 * Lowering logic for GML `with` statements to JavaScript.
 *
 * The `with` statement in GML iterates over one or more target instances,
 * temporarily rebinding `self` and `other` for the duration of the loop body.
 * This module provides the lowering transformation that converts a `with`
 * statement into a JavaScript `for` loop with proper scope management.
 */

import { Core } from "@gmloop/core";

/**
 * Generate JavaScript code that lowers a GML `with` statement.
 *
 * The generated code:
 * 1. Saves the current `self` and `other` bindings
 * 2. Evaluates the `with` expression to get target instance(s)
 * 3. Optionally calls a runtime hook to resolve targets
 * 4. Iterates over targets in a `for` loop, rebinding `self` and `other`
 * 5. Restores the original `self` and `other` after the loop
 *
 * @param testExpression - The evaluated test expression (e.g., "obj_player")
 * @param rawBody - The body of the with statement before lowering-controlled indentation
 * @param resolveWithTargetsIdent - Identifier for the runtime target resolver
 * @returns JavaScript code implementing the with statement semantics
 *
 * @example
 * ```typescript
 * const code = lowerWithStatement("obj_player", "x += 1;", "globalThis.__resolve_with_targets");
 * // Generates:
 * // {
 * //     const __with_prev_self = self;
 * //     const __with_prev_other = other;
 * //     const __with_value = obj_player;
 * //     const __with_targets = (() => { ... })();
 * //     for (let __with_index = 0; __with_index < __with_targets.length; __with_index += 1) {
 * //         const __with_self = __with_targets[__with_index];
 * //         self = __with_self;
 * //         other = __with_prev_self;
 * //         x += 1;
 * //     }
 * //     self = __with_prev_self;
 * //     other = __with_prev_other;
 * // }
 * ```
 */
export function lowerWithStatement(testExpression: string, rawBody: string, resolveWithTargetsIdent: string): string {
    // Keep indentation policy local to lowering so callers pass only semantic body text.
    // The regex ^(?=.) matches non-empty lines (including whitespace-only lines),
    // preserving existing formatting behavior while removing call-site plumbing.
    const indentedBody = rawBody.replaceAll(/^(?=.)/gm, "        ");

    const lines = [
        "{",
        "    const __with_prev_self = self;",
        "    const __with_prev_other = other;",
        `    const __with_value = ${testExpression};`,
        "    const __with_targets = (() => {",
        `        if (typeof ${resolveWithTargetsIdent} === "function") {`,
        `            return ${resolveWithTargetsIdent}(`,
        "                __with_value,",
        "                __with_prev_self,",
        "                __with_prev_other",
        "            );",
        "        }",
        "        if (__with_value == null) {",
        "            return [];",
        "        }",
        "        if (Array.isArray(__with_value)) {",
        "            return __with_value;",
        "        }",
        "        return [__with_value];",
        "    })();",
        "    try {",
        "        for (",
        "            let __with_index = 0;",
        "            __with_index < __with_targets.length;",
        "            __with_index += 1",
        "        ) {",
        "            const __with_self = __with_targets[__with_index];",
        "            self = __with_self;",
        "            other = __with_prev_self;",
        indentedBody,
        "        }",
        "    } finally {",
        "        self = __with_prev_self;",
        "        other = __with_prev_other;",
        "    }",
        "}"
    ];

    return Core.compactArray(lines).join("\n");
}
