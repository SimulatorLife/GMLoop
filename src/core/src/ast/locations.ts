import { toNumber } from "../utils/number.js";
import { isObjectLike, withObjectLike } from "../utils/object.js";
import type { GameMakerAstNode } from "./types.js";

type LocationKey = "start" | "end";
type LocationField = "index" | "line";

type LocationObject = { index?: number; line?: number };

type NodeRange = {
    start: number | null;
    end: number | null;
};

/**
 * Safely extract a numeric location field (`index` or `line`) from a node's
 * `start` or `end` location payload.
 *
 * The parser may represent locations either as:
 *   - a raw number
 *   - an object containing `{ index?: number; line?: number }`
 *   - `null` / `undefined`
 *
 * This helper normalizes all variants to `number | null`.
 *
 * @param {unknown} node AST node containing optional location metadata.
 * @param {"start" | "end"} key Location boundary to inspect.
 * @param {"index" | "line"} field Specific numeric field to extract.
 * @returns {number | null} Normalized numeric location or `null`.
 */
function getLocationNumber(node: unknown, key: LocationKey, field: LocationField): number | null {
    return withObjectLike(
        node,
        (nodeObject) => {
            const location = nodeObject[key];

            if (typeof location === "number") {
                return location;
            }

            return withObjectLike(
                location,
                (locationObject) => {
                    const value = locationObject[field];
                    return toNumber(value);
                },
                () => null
            );
        },
        () => null
    );
}

/**
 * Type guard for member access expressions.
 *
 * Certain member-expression nodes do not carry their own `start` position
 * and instead rely on their `object` sub-node. This guard allows callers
 * to detect those shapes safely.
 *
 * @param {unknown} node Potential AST node.
 * @returns {boolean} Whether the node is a supported member expression.
 */
function isMemberExpressionNode(node: unknown): node is { type?: string; object?: unknown } {
    if (!isObjectLike(node)) {
        return false;
    }

    const nodeObject = node as { type?: unknown };
    const type = nodeObject.type;

    return typeof type === "string" && (type === "MemberDotExpression" || type === "MemberIndexExpression");
}

/**
 * Retrieves the starting offset for a node while converting missing locations
 * to `null` for easier downstream checks.
 *
 * Member-expression nodes inherit their starting position from their `object`
 * sub-node when present. This avoids incorrect positioning for chained
 * expressions.
 *
 * @param {unknown} node AST node whose start position should be resolved.
 * @returns {number | null} Zero-based character index or `null`.
 */
function getNodeStartIndex(node: unknown): number | null {
    if (!isObjectLike(node)) {
        return null;
    }

    const nodeWithType = node as {
        type?: string;
        object?: unknown;
    };

    const isMemberAccess = isMemberExpressionNode(nodeWithType) && nodeWithType.object;

    if (isMemberAccess) {
        const objectStart = getNodeStartIndex(nodeWithType.object);

        if (typeof objectStart === "number") {
            return objectStart;
        }
    }

    return getLocationNumber(node, "start", "index");
}

/**
 * Reports the character offset immediately following the node's last token.
 *
 * When the `end` marker is missing, the helper falls back to the `start`
 * marker so that single-token constructs still have a usable anchor.
 *
 * @param {unknown} node AST node whose end boundary should be resolved.
 * @returns {number | null} One-past-the-end index or `null`.
 */
function getNodeEndIndex(node: unknown): number | null {
    const endIndex = getLocationNumber(node, "end", "index");

    if (typeof endIndex === "number") {
        return endIndex + 1;
    }

    const fallbackStart = getNodeStartIndex(node);

    return toNumber(fallbackStart);
}

/**
 * Resolves both the starting and ending offsets for a node in a single call.
 *
 * The helper mirrors {@link getNodeStartIndex} / {@link getNodeEndIndex} and
 * returns `null` for either boundary when it cannot be resolved from the
 * node's location metadata.
 *
 * Boundary semantics:
 * - `start` mirrors `getNodeStartIndex` (zero-based character index).
 * - `end` mirrors `getNodeEndIndex` (one-past-the-last-character index,
 *   suitable for use as the exclusive bound of `String#slice`).
 *
 * When the node has a numeric `end` it is bumped by one to convert the
 * inclusive end-of-token marker emitted by the parser into an exclusive
 * slice bound. When `end` is missing but `start` is present, the start is
 * reused so single-token constructs still produce a non-null degenerate
 * range. Both fields are `null` only when neither boundary can be derived.
 *
 * @param {unknown} node AST node whose bounds should be retrieved.
 * @returns `{ start, end }` with `start` zero-based and `end` exclusive.
 */
function getNodeRangeIndices(node: unknown): NodeRange {
    const start = getNodeStartIndex(node);
    const endIndex = getLocationNumber(node, "end", "index");

    let end = null;

    if (typeof endIndex === "number") {
        end = endIndex + 1;
    } else if (typeof start === "number") {
        end = start;
    }

    return { start, end };
}

/**
 * Clone a location payload defensively.
 *
 * Structured cloning avoids leaking shared references between nodes when
 * synthesizing or transforming AST structures.
 *
 * @template TLocation
 * @param {TLocation | undefined} location Location object or primitive.
 * @returns {TLocation | undefined} Cloned location.
 */
function cloneLocation<TLocation = unknown>(location?: TLocation): TLocation | undefined {
    if (isObjectLike(location)) {
        return structuredClone(location);
    }

    if (location == null) {
        return location ?? undefined;
    }

    return location;
}

/**
 * Copy the `start`/`end` location metadata from `template` onto `target`
 * while cloning each boundary to avoid shared references.
 *
 * Frequently used when synthesizing AST nodes from existing ones.
 *
 * @template TTarget extends object
 * @param {TTarget | null | undefined} target Node to mutate.
 * @param {unknown} template Source node providing location metadata.
 * @returns {TTarget | null | undefined} The original target reference.
 */
function assignClonedLocation<TTarget extends GameMakerAstNode>(
    target: TTarget | null | undefined,
    template: unknown
): TTarget | null | undefined {
    return withObjectLike(
        target,
        (mutableTarget) =>
            withObjectLike(
                template,
                (templateNode) => {
                    const hasStart = Object.hasOwn(templateNode, "start");
                    const hasEnd = Object.hasOwn(templateNode, "end");

                    if (!hasStart && !hasEnd) {
                        return mutableTarget;
                    }

                    Object.assign(mutableTarget, {
                        ...(hasStart ? { start: cloneLocation(templateNode.start) } : {}),
                        ...(hasEnd ? { end: cloneLocation(templateNode.end) } : {})
                    });

                    return mutableTarget;
                },
                () => mutableTarget
            ),
        () => target
    );
}

/**
 * Select the preferred location object from a list of candidates.
 *
 * Iterates `candidates` in declaration order and returns the first one that
 * is neither `null` nor `undefined`. Object-like inputs are returned as-is;
 * numeric inputs are normalized to `{ index: number }` so downstream
 * consumers can treat every accepted value uniformly as a
 * {@link LocationObject}.
 *
 * Useful when reconciling location metadata from multiple parser sources
 * (for example an explicit `node.start` together with a fallback value
 * derived from the parser's token stream), or when callers want to accept
 * either a raw index or a fully populated location descriptor through the
 * same code path.
 *
 * @param {...(object|number|null|undefined)} candidates Ordered location
 *        candidates; earlier entries win when several are usable.
 * @returns {LocationObject | null} First usable candidate, or `null` when
 *          every entry is nullish.
 */
function getPreferredLocation(...candidates: Array<LocationObject | number | null | undefined>): LocationObject | null {
    for (const candidate of candidates) {
        if (candidate == null) {
            continue;
        }

        if (isObjectLike(candidate)) {
            return candidate as LocationObject;
        }

        if (typeof candidate === "number") {
            return { index: candidate };
        }
    }

    return null;
}

/**
 * Retrieve the one-based line number where `node` begins.
 *
 * Line numbers follow the ANTLR/`GameMakerAstLocation.line` convention: the
 * first line of the source file is `1`, not `0`. Returns `null` when the
 * node has no resolvable `start` location.
 *
 * @param {unknown} node AST node.
 * @returns {number | null} One-based line index or `null`.
 */
function getNodeStartLine(node: unknown): number | null {
    return getLocationNumber(node, "start", "line");
}

/**
 * Retrieve the one-based line number where `node` ends.
 *
 * Line numbers follow the ANTLR/`GameMakerAstLocation.line` convention: the
 * first line of the source file is `1`, not `0`. Falls back to the node's
 * start line when no explicit end line is attached so single-token
 * constructs still produce a usable anchor.
 *
 * @param {unknown} node AST node.
 * @returns {number | null} One-based line index or `null`.
 */
function getNodeEndLine(node: unknown): number | null {
    return getLocationNumber(node, "end", "line") ?? getLocationNumber(node, "start", "line");
}

export {
    assignClonedLocation,
    cloneLocation,
    getNodeEndIndex,
    getNodeEndLine,
    getNodeRangeIndices,
    getNodeStartIndex,
    getNodeStartLine,
    getPreferredLocation
};
