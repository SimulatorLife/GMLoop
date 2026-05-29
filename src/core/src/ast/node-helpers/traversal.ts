import { isObjectLike } from "../../utils/object.js";
import type { GameMakerAstNode } from "../types.js";

const TRAVERSAL_LINK_PARENT_KEY = "parent";
const TRAVERSAL_LINK_ENCLOSING_NODE_KEY = "enclosingNode";
const TRAVERSAL_LINK_PRECEDING_NODE_KEY = "precedingNode";
const TRAVERSAL_LINK_FOLLOWING_NODE_KEY = "followingNode";

function isTraversalLinkKey(key: string): boolean {
    return (
        key === TRAVERSAL_LINK_PARENT_KEY ||
        key === TRAVERSAL_LINK_ENCLOSING_NODE_KEY ||
        key === TRAVERSAL_LINK_PRECEDING_NODE_KEY ||
        key === TRAVERSAL_LINK_FOLLOWING_NODE_KEY
    );
}

/**
 * Clone an AST node while preserving primitives.
 *
 * @param node Candidate AST fragment to clone.
 * @returns A structural clone of the node or the original primitive when cloning is unnecessary.
 */
export function cloneAstNode(node?: unknown) {
    if (node == null) {
        return null;
    }

    if (typeof node !== "object") {
        return node;
    }

    const clonedNode = cloneNodeValueWithoutTraversalLinks(node, new WeakMap<object, unknown>());
    restoreLocalParentLinks(clonedNode);
    return clonedNode;
}

function cloneNodeValueWithoutTraversalLinks(nodeValue: unknown, seenNodes: WeakMap<object, unknown>): unknown {
    if (!isObjectLike(nodeValue)) {
        return nodeValue;
    }

    const objectNodeValue = nodeValue as object;
    const existingClone = seenNodes.get(objectNodeValue);
    if (existingClone) {
        return existingClone;
    }

    if (Array.isArray(nodeValue)) {
        const clonedArray: Array<unknown> = [];
        seenNodes.set(objectNodeValue, clonedArray);
        for (const entry of nodeValue) {
            clonedArray.push(cloneNodeValueWithoutTraversalLinks(entry, seenNodes));
        }
        return clonedArray;
    }

    const clonedRecord: Record<string, unknown> = {};
    seenNodes.set(objectNodeValue, clonedRecord);
    const nodeKeys = Object.keys(nodeValue);
    for (let i = 0, len = nodeKeys.length; i < len; i++) {
        const key = nodeKeys[i];
        if (
            key === TRAVERSAL_LINK_PARENT_KEY ||
            key === TRAVERSAL_LINK_ENCLOSING_NODE_KEY ||
            key === TRAVERSAL_LINK_PRECEDING_NODE_KEY ||
            key === TRAVERSAL_LINK_FOLLOWING_NODE_KEY
        ) {
            continue;
        }
        // No `Object.entries()` allocation: direct key lookup avoids the
        // [key, value] tuple allocation that the iterator produces per iteration.
        clonedRecord[key] = cloneNodeValueWithoutTraversalLinks((nodeValue as Record<string, unknown>)[key], seenNodes);
    }

    return clonedRecord;
}

function restoreLocalParentLinks(clonedNode: unknown): void {
    const visitedNodes = new WeakSet<object>();

    const visit = (currentValue: unknown, parentNode: Record<string, unknown> | null): void => {
        if (!isObjectLike(currentValue)) {
            return;
        }

        const objectValue = currentValue as object;
        if (visitedNodes.has(objectValue)) {
            return;
        }
        visitedNodes.add(objectValue);

        if (Array.isArray(currentValue)) {
            for (const entry of currentValue) {
                visit(entry, parentNode);
            }
            return;
        }

        const currentRecord = currentValue as Record<string, unknown>;
        const hasNodeType = typeof currentRecord.type === "string";
        if (parentNode && hasNodeType) {
            currentRecord.parent = parentNode;
        }
        const nextParentNode = hasNodeType ? currentRecord : parentNode;

        for (let i = 0, keys = Object.keys(currentRecord), len = keys.length; i < len; i++) {
            const key = keys[i];
            if (
                key === TRAVERSAL_LINK_PARENT_KEY ||
                key === TRAVERSAL_LINK_ENCLOSING_NODE_KEY ||
                key === TRAVERSAL_LINK_PRECEDING_NODE_KEY ||
                key === TRAVERSAL_LINK_FOLLOWING_NODE_KEY
            ) {
                continue;
            }
            const childValue = currentRecord[key];
            if (isObjectLike(childValue)) {
                visit(childValue, nextParentNode);
            }
        }
    };

    visit(clonedNode, null);
}

/**
 * Iterate over the object-valued children of an AST node.
 *
 * @param node Potential AST node to inspect.
 * @param callback Invoked for each enumerable own property whose value is object-like.
 */
export function forEachNodeChild(node: unknown, callback: (child: GameMakerAstNode, key: string) => void) {
    if (!isObjectLike(node)) {
        return;
    }

    const nodeValue = node as GameMakerAstNode;
    const keys = Object.keys(nodeValue);
    const length = keys.length;

    for (let i = 0; i < length; i++) {
        const key = keys[i];
        if (isTraversalLinkKey(key)) {
            continue;
        }

        const value = nodeValue[key as keyof GameMakerAstNode];
        if (isObjectLike(value)) {
            callback(value, key);
        }
    }
}

/**
 * Determine whether an AST traversal should skip the given node.
 *
 * @param node Candidate AST node or value to inspect.
 * @param visited Optional WeakSet tracking already-visited nodes.
 * @returns `true` when traversal should skip this node.
 */
export function shouldSkipTraversal(node: unknown, visited?: WeakSet<object>): boolean {
    if (!node || typeof node !== "object") {
        return true;
    }

    if (visited !== undefined && visited.has(node)) {
        return true;
    }

    return false;
}

/**
 * Traverse nested child nodes and invoke `callback` for each descendant.
 *
 * @param node Candidate AST fragment to inspect.
 * @param callback Invoked for each child value that should be visited.
 */
export function visitChildNodes(node: unknown, callback: (child: unknown) => void): void {
    if (node == null) {
        return;
    }

    if (Array.isArray(node)) {
        // Preserve snapshot semantics (mutation safety) while avoiding the extra
        // iterator overhead of the spread + for...of pattern. Array.prototype.slice()
        // creates a shallow copy with fewer allocations than [...node].
        const snapshot = node.slice();
        for (let i = 0, len = snapshot.length; i < len; i++) {
            callback(snapshot[i]);
        }
        return;
    }

    if (typeof node !== "object") {
        return;
    }

    for (const key of Object.keys(node)) {
        const value = (node as Record<string, unknown>)[key];
        if (isObjectLike(value)) {
            callback(value);
        }
    }
}

/**
 * Recursively visit every object-valued child of `node`, skipping
 * `parent` / `enclosingNode` / `precedingNode` / `followingNode` traversal links.
 *
 * This is a depth-first traversal that fires `callback` for every object-like
 * value reachable from `node` (including array elements) except the traversal-link
 * keys themselves.  The callback is invoked before descending into each
 * discovered child so callers can inspect or mutate child nodes as the walk
 * proceeds.
 *
 * @param node     Root of the subtree to traverse.
 * @param callback Invoked for every object-like value reachable from `node`.
 */
export function visitNonTraversalChildValues(node: unknown, callback: (child: unknown) => void): void {
    if (!isObjectLike(node)) {
        return;
    }

    if (Array.isArray(node)) {
        for (const entry of node) {
            visitNonTraversalChildValues(entry, callback);
        }
        return;
    }

    for (const [key, value] of Object.entries(node)) {
        if (isTraversalLinkKey(key)) {
            continue;
        }
        if (isObjectLike(value)) {
            callback(value);
            visitNonTraversalChildValues(value, callback);
        }
    }
}

/**
 * Push object children onto a traversal stack.
 *
 * @param stack Stack collecting object child values.
 * @param value Candidate child value.
 */
export function enqueueObjectChildValues(stack: unknown[], value: unknown): void {
    if (!value || typeof value !== "object") {
        return;
    }

    if (Array.isArray(value)) {
        const { length } = value;
        for (let index = 0; index < length; ++index) {
            const item = value[index];
            if (item !== null && typeof item === "object") {
                stack.push(item);
            }
        }
        return;
    }

    stack.push(value);
}
