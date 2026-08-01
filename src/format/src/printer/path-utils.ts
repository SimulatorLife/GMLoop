import type { AstPath } from "prettier";

/**
 * Safely retrieves the parent node from a Prettier AST path.
 *
 * This function guards against cases where path.getParentNode might not exist
 * (e.g., in older Prettier versions, edge cases, or mock test objects).
 *
 * @param path - The Prettier AST path object
 * @param level - Optional: number of levels up to traverse (defaults to 0, i.e., immediate parent)
 * @returns The parent node, or null if not available
 *
 * @example
 * ```ts
 * const parent = safeGetParentNode(path);
 * if (parent && parent.type === "FunctionDeclaration") {
 *     // safe to access parent properties
 * }
 * ```
 */
export function safeGetParentNode(path: AstPath<any>, level: number = 0): any {
    // Check if getParentNode exists and is a function
    if (typeof path.getParentNode === "function") {
        return path.getParentNode(level);
    }

    // Fallback: use path.parent for level 0, otherwise return null
    if (level === 0 && "parent" in path) {
        return path.parent ?? null;
    }

    return null;
}

/**
 * Safely reads the current node value from an AstPath.
 *
 * This keeps printer logic from repeating `typeof path.getValue === "function"`
 * guards whenever a path may come from partial mocks or boundary code.
 *
 * @param path - The Prettier AstPath object.
 * @returns The node value, or `null` when unavailable.
 */
export function safeGetPathValue(path: AstPath<any>): any {
    if (path && typeof path.getValue === "function") {
        return path.getValue();
    }

    return null;
}

/**
 * Safely reads the current property name from an AstPath.
 *
 * Some path objects in tests and fallback call sites may not expose
 * `getName`; this helper normalizes that behavior to `null`.
 *
 * @param path - The Prettier AstPath object.
 * @returns The current path property name, or `null` when unavailable.
 */
export function safeGetPathName(path: AstPath<any>): PropertyKey | null {
    if (path && typeof path.getName === "function") {
        return path.getName();
    }

    return null;
}

/**
 * Walks up the Prettier AST path and returns the first ancestor node for
 * which the given predicate returns `true`.
 *
 * This helper eliminates repeated ancestor-traversal boilerplate shared by
 * functions that search for a specific enclosing node kind (e.g.,
 * the nearest enclosing function declaration or constructor).
 *
 * PERFORMANCE: When `targetType` is a plain string (not a function), the
 * implementation short-circuits the predicate call entirely and performs
 * a direct `===` string comparison. This eliminates function-call overhead,
 * closure allocation, and optional-chain evaluation on the hot inner loop.
 * Callers that match on `node.type === "X"` should always pass the string
 * directly to benefit from the fast path.
 *
 * @param path - The Prettier AST path object.
 * @param predicateOrType - Either a predicate function, or a node type string
 *                          for O(1) exact-type matching.
 * @returns The first matching ancestor node, or `null` if none is found.
 *
 * @example
 * ```ts
 * const enclosingFn = findAncestorNode(path, "FunctionDeclaration");
 * const enclosingFn2 = findAncestorNode(path, (node) => node.type === "FunctionDeclaration");
 * ```
 */
export function findAncestorNode(path: AstPath<any>, predicateOrType: string | ((node: any) => boolean)): any {
    if (!path || typeof path.getParentNode !== "function") {
        return null;
    }

    const isTypeString = typeof predicateOrType === "string";
    const targetType = isTypeString ? predicateOrType : null;

    for (let depth = 0; ; depth += 1) {
        const parent = safeGetParentNode(path, depth);
        if (!parent) {
            return null;
        }

        if (isTypeString) {
            // Fast path: direct string comparison avoids function-call overhead.
            if ((parent as { type?: unknown }).type === targetType) {
                return parent;
            }
        } else if (predicateOrType(parent)) {
            return parent;
        }
    }
}
