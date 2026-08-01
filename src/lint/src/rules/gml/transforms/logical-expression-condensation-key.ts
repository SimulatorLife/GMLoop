/**
 * AST node identity utilities used by the logical-expression condensation
 * pipeline. The condensation pass deduplicates variables and intermediate
 * boolean expressions by canonical key, so a stable, content-derived key is
 * the foundation the rest of the pipeline relies on.
 *
 * Extracted from `logical-expression-condensation.ts` to keep the long-file
 * boundary under the 1000-line target. Behavior is preserved exactly; only
 * the source layout has changed.
 */
import { Core } from "@gmloop/core";

const { isObjectLike } = Core;

// `isObjectLike` is re-exported so the boolean-expression and ast-builders
// modules can use the same predicate without each reaching into `@gmloop/core`.
export { isObjectLike };

const COMMON_IGNORED_NODE_KEYS = [
    "start",
    "end",
    "comments",
    "parent",
    "enclosingNode",
    "precedingNode",
    "followingNode"
];

const TRAVERSAL_IGNORED_KEYS = new Set(["body", ...COMMON_IGNORED_NODE_KEYS]);

const IGNORED_NODE_KEYS = new Set(COMMON_IGNORED_NODE_KEYS);

function stringifyNodeScalar(value: unknown) {
    if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean" ||
        typeof value === "bigint"
    ) {
        return String(value);
    }
    return "";
}

function getAstNodeKey(node: unknown) {
    if (node === null) {
        return "null";
    }

    if (node === undefined) {
        return "undefined";
    }

    if (Array.isArray(node)) {
        return `Array:[${node.map((item) => getAstNodeKey(item)).join(",")}]`;
    }

    if (typeof node === "string" || typeof node === "number" || typeof node === "boolean" || typeof node === "bigint") {
        return String(node);
    }

    if (typeof node === "symbol") {
        return node.toString();
    }

    if (typeof node === "function") {
        return `[Function:${node.name || "anonymous"}]`;
    }

    const typedNode = node as Record<string, unknown>;
    const { type } = typedNode;
    if (typeof type !== "string" || type.length === 0) {
        const entries = Object.entries(typedNode)
            .filter(([key]) => !IGNORED_NODE_KEYS.has(key))
            .map(([key, value]) => `${key}:${getAstNodeKey(value)}`)
            .join("|");
        return `{${entries}}`;
    }

    switch (type) {
        case "Identifier": {
            return `Identifier:${stringifyNodeScalar(typedNode.name)}`;
        }
        case "Literal": {
            return `Literal:${stringifyNodeScalar(typedNode.value)}`;
        }
        case "MemberDotExpression": {
            return `MemberDot:${getAstNodeKey(typedNode.object)}.${getAstNodeKey(typedNode.property)}`;
        }
        case "MemberIndexExpression": {
            const indices = Array.isArray(typedNode.property)
                ? typedNode.property.map((item) => getAstNodeKey(item)).join(",")
                : getAstNodeKey(typedNode.property);
            return `MemberIndex:${getAstNodeKey(typedNode.object)}[${indices}]`;
        }
        case "CallExpression": {
            return `Call:${getAstNodeKey(typedNode.object)}(${
                Array.isArray(typedNode.arguments) ? typedNode.arguments.map((arg) => getAstNodeKey(arg)).join(",") : ""
            })`;
        }
        case "UnaryExpression": {
            return `Unary:${stringifyNodeScalar(typedNode.operator)}(${getAstNodeKey(typedNode.argument)})`;
        }
        case "BinaryExpression": {
            return `Binary:${stringifyNodeScalar(typedNode.operator)}(${getAstNodeKey(
                typedNode.left
            )}:${getAstNodeKey(typedNode.right)})`;
        }
        case "ParenthesizedExpression": {
            return `Paren:${getAstNodeKey(typedNode.expression)}`;
        }
        default: {
            const entries = Object.entries(typedNode)
                .filter(([key]) => !IGNORED_NODE_KEYS.has(key))
                .map(([key, value]) => `${key}:${getAstNodeKey(value)}`)
                .join("|");
            return `${type}:{${entries}}`;
        }
    }
}

export { COMMON_IGNORED_NODE_KEYS, getAstNodeKey, IGNORED_NODE_KEYS, TRAVERSAL_IGNORED_KEYS };
