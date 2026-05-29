import { toNumber } from "../utils/number.js";
import { isObjectLike, withObjectLike } from "../utils/object.js";
import type { GameMakerAstNode } from "./types.js";

type AstNode = GameMakerAstNode;
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
 * The helper mirrors `getNodeStartIndex` / `getNodeEndIndex`
 * by returning `null` when either boundary is unavailable.
 *
 * The end boundary is exclusive when defined.
 *
 * @param {unknown} node AST node whose bounds should be retrieved.
 * @returns {{ start: number | null, end: number | null }}
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
function assignClonedLocation<TTarget extends AstNode>(
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
 * Returns the first object-like candidate found.
 * Numeric indices are normalized to `{ index: number }`.
 *
 * @param {...(object|number|null|undefined)} candidates
 * @returns {object | null}
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
 * Retrieve the zero-based line number where `node` begins.
 *
 * @param {unknown} node AST node.
 * @returns {number | null} Line index or `null`.
 */
function getNodeStartLine(node: unknown): number | null {
    return getLocationNumber(node, "start", "line");
}

/**
 * Retrieve the zero-based line number where `node` ends.
 *
 * Falls back to the node's start line if no explicit end line exists.
 *
 * @param {unknown} node AST node.
 * @returns {number | null} Line index or `null`.
 */
function getNodeEndLine(node: unknown): number | null {
    return getLocationNumber(node, "end", "line") ?? getLocationNumber(node, "start", "line");
}

/**
 * Safely extract the source text covered by an AST node.
 *
 * Consolidates the repeated guard pattern:
 *   const start = getNodeStartIndex(node);
 *   const end = getNodeEndIndex(node);
 *   if (typeof start !== "number" || typeof end !== "number") { return null; }
 *   return sourceText.slice(start, end);
 *
 * @param sourceText Full source text of the file.
 * @param node       AST node whose bounds should be used.
 * @returns The source text slice for `node`, or `null` when either boundary is not a valid offset.
 */
function getNodeSourceText(sourceText: string, node: unknown): string | null {
    const start = getNodeStartIndex(node);
    const end = getNodeEndIndex(node);
    if (typeof start !== "number" || typeof end !== "number") {
        return null;
    }
    return sourceText.slice(start, end);
}

export {
    assignClonedLocation,
    cloneLocation,
    getNodeEndIndex,
    getNodeEndLine,
    getNodeRangeIndices,
    getNodeSourceText,
    getNodeStartIndex,
    getNodeStartLine,
    getPreferredLocation
};
