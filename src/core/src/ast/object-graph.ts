import { isObjectLike } from "../utils/object.js";
import type { GameMakerAstNode } from "./types.js";

type ObjectRecord = Record<string, unknown>;
const AST_TRAVERSAL_LINK_KEYS = new Set(["declaration", "enclosingNode", "followingNode", "precedingNode"]);

/** Location of a node within a typed AST traversal. */
export type GameMakerAstTraversalContext = Readonly<{
    index: number | null;
    key: string | null;
    parent: GameMakerAstNode | null;
}>;

/** Callbacks invoked while traversing a typed GameMaker AST. */
export type GameMakerAstTraversalVisitor = Readonly<{
    enter?: (node: GameMakerAstNode, context: GameMakerAstTraversalContext) => boolean | void;
    leave?: (node: GameMakerAstNode, context: GameMakerAstTraversalContext) => void;
}>;

type AstTraversalFrame = Readonly<{
    context: GameMakerAstTraversalContext;
    leaving: boolean;
    node: GameMakerAstNode;
}>;

function isTypedGameMakerAstNode(value: unknown): value is GameMakerAstNode & { type: string } {
    return isObjectLike(value) && typeof (value as { type?: unknown }).type === "string";
}

function shouldSkipAstChildKey(node: GameMakerAstNode, key: string): boolean {
    if (key === "parent") {
        return node.type !== "ConstructorDeclaration";
    }
    return AST_TRAVERSAL_LINK_KEYS.has(key);
}

/**
 * Visit each direct typed AST child in deterministic property and array order.
 *
 * Traversal links and semantic declaration back-references are excluded. The
 * constructor `parent` clause remains a syntax child despite sharing the
 * historical traversal-link property name.
 */
export function forEachAstChild(
    node: GameMakerAstNode,
    callback: (child: GameMakerAstNode, context: GameMakerAstTraversalContext) => void
): void {
    for (const key of Object.keys(node)) {
        if (shouldSkipAstChildKey(node, key)) {
            continue;
        }

        const childValue = (node as Record<string, unknown>)[key];
        if (Array.isArray(childValue)) {
            for (const [index, child] of childValue.entries()) {
                if (isTypedGameMakerAstNode(child)) {
                    callback(child, { index, key, parent: node });
                }
            }
            continue;
        }

        if (isTypedGameMakerAstNode(childValue)) {
            callback(childValue, { index: null, key, parent: node });
        }
    }
}

/**
 * Traverse a typed GameMaker AST depth-first with balanced enter/leave events.
 *
 * Returning `false` from `enter` skips that node's children while still
 * invoking `leave`. Shared or cyclic nodes are visited once.
 */
export function traverseAst(root: unknown, visitor: GameMakerAstTraversalVisitor): void {
    if (!isTypedGameMakerAstNode(root)) {
        return;
    }

    const rootContext: GameMakerAstTraversalContext = { index: null, key: null, parent: null };
    const stack: AstTraversalFrame[] = [{ context: rootContext, leaving: false, node: root }];
    const seen = new WeakSet<object>();

    while (stack.length > 0) {
        const frame = stack.pop();
        if (frame === undefined) {
            continue;
        }

        if (frame.leaving) {
            visitor.leave?.(frame.node, frame.context);
            continue;
        }

        if (seen.has(frame.node)) {
            continue;
        }
        seen.add(frame.node);

        stack.push({ ...frame, leaving: true });
        if (visitor.enter?.(frame.node, frame.context) === false) {
            continue;
        }

        const children: Array<{ child: GameMakerAstNode; context: GameMakerAstTraversalContext }> = [];
        forEachAstChild(frame.node, (child, context) => children.push({ child, context }));
        for (let index = children.length - 1; index >= 0; index -= 1) {
            const child = children[index];
            stack.push({ context: child.context, leaving: false, node: child.child });
        }
    }
}

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
            // Capture child references onto the traversal stack *before* calling
            // the enterArray callback so that mutations inside the callback
            // (splice, push, etc.) cannot cause elements to be skipped.
            const childStart = stackValues.length;
            for (let index = value.length - 1; index >= 0; index -= 1) {
                const item = value[index];
                if (!item || typeof item !== "object") {
                    continue;
                }

                stackValues.push(item as object | Array<unknown>);
                stackParents.push(value);
                stackKeys.push(index);
            }

            if (typeof enterArray === "function") {
                const shouldTraverse = enterArray(value, parent, key);
                if (shouldTraverse === false) {
                    stackValues.length = childStart;
                    stackParents.length = childStart;
                    stackKeys.length = childStart;
                    continue;
                }
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

            stackValues.push(childValue);
            stackParents.push(objectValue);
            stackKeys.push(childKey);
        }
    }
}
