import { isObjectLike } from "../utils/object.js";
import { isNode } from "./node-helpers/index.js";

type ObjectRecord = Record<string, unknown>;

export type WalkObjectGraphOptions = {
    enterObject?: (
        value: ObjectRecord,
        parent: ObjectRecord | Array<unknown> | null,
        key: string | number | null
    ) => boolean | void;
    enterArray?: (
        value: Array<unknown>,
        parent: ObjectRecord | Array<unknown> | null,
        key: string | number | null
    ) => boolean | void;
};

export function walkObjectGraph(root: unknown, options: WalkObjectGraphOptions = {}) {
    if (!isObjectLike(root) && !Array.isArray(root)) {
        return;
    }

    const { enterObject, enterArray } = options;
    // Keep traversal state in parallel arrays instead of allocating `{ value, parent, key }`
    // frame objects for every edge we visit. This is on the parser/formatter hot path and
    // reducing per-node allocations measurably improves walk throughput.
    const stackValues: Array<object | Array<unknown>> = [root as object | Array<unknown>];
    const stackParents: Array<ObjectRecord | Array<unknown> | null> = [null];
    const stackKeys: Array<string | number | null> = [null];
    const seen = new WeakSet<object | Array<unknown>>();

    while (stackValues.length > 0) {
        const value = stackValues.pop();
        const parent = stackParents.pop();
        const key = stackKeys.pop();

        if (!value || typeof value !== "object") {
            continue;
        }

        if (seen.has(value)) {
            continue;
        }

        seen.add(value);

        if (Array.isArray(value)) {
            const arraySnapshot = value.slice();
            if (typeof enterArray === "function") {
                const shouldTraverse = enterArray(value, parent, key);
                if (shouldTraverse === false) {
                    continue;
                }
            }

            for (let index = arraySnapshot.length - 1; index >= 0; index -= 1) {
                const item = arraySnapshot[index];
                if (!item || typeof item !== "object") {
                    continue;
                }

                stackValues.push(item as object | Array<unknown>);
                stackParents.push(value);
                stackKeys.push(index);
            }

            continue;
        }

        const objectValue = value as ObjectRecord;

        if (typeof enterObject === "function") {
            const shouldTraverse = enterObject(objectValue, parent, key);
            if (shouldTraverse === false) {
                continue;
            }
        }

        const keys = Object.keys(objectValue);
        // Object.keys() only returns own enumerable string-keyed properties, so
        // the Object.hasOwn check is redundant. Removing it reduces iterations
        // in this hot path by eliminating an unnecessary property lookup.
        for (let index = keys.length - 1; index >= 0; index -= 1) {
            const childKey = keys[index];
            const childValue = objectValue[childKey];
            if (!childValue || typeof childValue !== "object") {
                continue;
            }

            stackValues.push(childValue as object | Array<unknown>);
            stackParents.push(objectValue);
            stackKeys.push(childKey);
        }
    }
}

/**
 * Simplified AST walker that visits each AST node with a single callback.
 *
 * This helper wraps `walkObjectGraph` to provide a simpler interface for AST
 * traversal where the visitor function receives each node along with its parent
 * and key context. The visitor can return `false` to prevent descending into
 * child nodes.
 *
 * Unlike `walkObjectGraph`, which separates object and array handling, this
 * function filters to AST nodes (via `isNode`) and provides a unified callback
 * signature that matches the common pattern used throughout the plugin layer.
 *
 * @param root The root node or value to start traversal from.
 * @param visitor Callback invoked for each AST node. Receives the node, its
 *                parent (object or array), and the key (string or number) by
 *                which it's referenced. Return `false` to skip descending into
 *                this node's children.
 */
export function walkAst(
    root: unknown,
    visitor: (node: any, parent: unknown, key: string | number | null) => void | boolean
): void {
    walkObjectGraph(root, {
        enterObject(value, parent, key) {
            if (!isNode(value)) {
                return;
            }

            return visitor(value, parent, key);
        },
        enterArray() {
            // Arrays themselves are not AST nodes, but we need to traverse
            // them to reach the nodes they contain. Always descend into arrays.
        }
    });
}
