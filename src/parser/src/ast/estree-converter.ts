/**
 * Converts a GML AST to ESTree-compatible format.
 *
 * ESTree is the standard AST interchange format used by Prettier, ESLint, and
 * related JavaScript tooling. This module belongs in the parser workspace
 * because ESTree conversion is one of the parser's output formats, produced
 * when the caller sets `astFormat: "estree"` in the parser options.
 *
 * Previously this file lived in `@gmloop/core` (`core/src/ast/estree-converter.ts`).
 * It was moved here because the Core workspace must not own Prettier-specific
 * behaviour; the parser owns its own output-format conversions and is the sole
 * consumer of this utility.
 */
import { Core } from "@gmloop/core";

/**
 * A raw AST location boundary as stored in the GML AST.
 * Boundaries may be plain numeric offsets or objects carrying index/offset/start
 * along with optional line/column metadata.
 */
type AstBoundary =
    | number
    | {
          index?: number;
          offset?: number;
          start?: number;
          line?: number | null;
          column?: number | null;
      }
    | null
    | undefined;

/** Internal traversal state threaded through the recursive conversion. */
type ConversionState = {
    readonly includeLocations: boolean;
    readonly includeRange: boolean;
    readonly includeComments: boolean;
};

/** Options accepted by {@link convertToESTree}. */
export type ESTreeConversionOptions = {
    includeLocations?: boolean;
    includeRange?: boolean;
    includeComments?: boolean;
};

/** An ESTree location point (line + column). */
type EsTreePoint = { line: number | null; column: number | null };

/** An ESTree source location span. */
type EsTreeLoc = { start: EsTreePoint; end: EsTreePoint };

const COMMENT_TYPE_MAP = new Map<string, string>([
    ["CommentLine", "Line"],
    ["CommentBlock", "Block"],
    ["Whitespace", "Whitespace"]
]);

/** Skipped property names during deep property copy. */
const SKIPPED_OWN_KEYS = new Set(["type", "start", "end", "declaration"]);

/**
 * Extract a numeric character offset from an AST boundary value.
 * Returns `null` when no finite number can be found.
 */
function normalizeBoundary(boundary: AstBoundary): number | null {
    if (boundary == null) {
        return null;
    }

    if (typeof boundary === "number") {
        return Number.isFinite(boundary) ? boundary : null;
    }

    if (typeof boundary !== "object") {
        return null;
    }

    const asObj = boundary as Record<string, unknown>;
    if (typeof asObj.index === "number" && Number.isFinite(asObj.index)) {
        return asObj.index;
    }

    if (typeof asObj.offset === "number" && Number.isFinite(asObj.offset)) {
        return asObj.offset;
    }

    if (typeof asObj.start === "number" && Number.isFinite(asObj.start)) {
        return asObj.start;
    }

    return null;
}

/**
 * Build an ESTree `loc` object from two raw AST boundary values.
 * Returns `null` when neither boundary carries line information.
 */
function buildLoc(boundaryStart: AstBoundary, boundaryEnd: AstBoundary): EsTreeLoc | null {
    if (!boundaryStart || !boundaryEnd) {
        return null;
    }

    const startObj = boundaryStart as Record<string, unknown>;
    const endObj = boundaryEnd as Record<string, unknown>;

    const startLine = typeof startObj.line === "number" ? startObj.line : null;
    const endLine = typeof endObj.line === "number" ? endObj.line : null;

    if (startLine == null && endLine == null) {
        return null;
    }

    const startColumn = typeof startObj.column === "number" ? startObj.column : null;
    const endColumn = typeof endObj.column === "number" ? endObj.column : null;

    return {
        start: { line: startLine, column: startColumn },
        end: { line: endLine, column: endColumn }
    };
}

/**
 * Determine whether a property key should be copied into the ESTree result.
 */
function shouldCopyKey(key: string, includeComments: boolean): boolean {
    if (SKIPPED_OWN_KEYS.has(key)) {
        return false;
    }

    if (!includeComments && key === "comments") {
        return false;
    }

    return true;
}

/**
 * Copy own enumerable properties from a GML node object to a new result record,
 * recursively converting nested values.
 *
 * Returns a plain object containing the filtered and converted properties.
 */
function buildNodeProperties(source: Record<string, unknown>, state: ConversionState): Record<string, unknown> {
    const properties: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
        if (!shouldCopyKey(key, state.includeComments)) {
            continue;
        }
        properties[key] = convertNode(source[key], state);
    }
    return properties;
}

/**
 * Build ESTree location metadata entries to merge into a node result.
 * Returns an object with `loc`, `start`, `end`, and/or `range` fields, depending
 * on the conversion state. Returns an empty object when no metadata is included.
 */
function buildLocationMetadata(source: Record<string, unknown>, state: ConversionState): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};

    if (state.includeLocations) {
        const loc = buildLoc(source.start, source.end);
        if (loc) {
            metadata.loc = loc;
        }
    }

    if (state.includeRange) {
        const startIndex = normalizeBoundary(source.start);
        const endIndex = normalizeBoundary(source.end);

        if (startIndex !== null && endIndex !== null) {
            metadata.start = startIndex;
            metadata.end = endIndex;
            metadata.range = [startIndex, endIndex];
        }
    }

    return metadata;
}

/**
 * Recursively convert a single GML AST value to its ESTree representation.
 */
function convertNode(value: unknown, state: ConversionState): unknown {
    if (value == null) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((item: unknown) => convertNode(item, state));
    }

    if (!Core.isObjectLike(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    const isAstNode = Core.isNonEmptyString(source.type);
    const baseType = isAstNode ? { type: source.type } : {};
    const nodeProperties = buildNodeProperties(source, state);

    if (!isAstNode) {
        return { ...baseType, ...nodeProperties };
    }

    const rawType = baseType.type as string;
    const resolvedType = COMMENT_TYPE_MAP.get(rawType) ?? rawType;
    const locationMetadata = buildLocationMetadata(source, state);

    return { type: resolvedType, ...nodeProperties, ...locationMetadata };
}

/**
 * Convert a GML AST tree to an ESTree-compatible representation.
 *
 * @param root - The root GML AST node to convert.
 * @param options - Conversion options controlling location, range, and comment output.
 * @returns The converted ESTree-compatible AST.
 */
export function convertToESTree(root: unknown, options: ESTreeConversionOptions = {}): unknown {
    const state: ConversionState = {
        includeLocations: options.includeLocations !== false,
        includeRange: options.includeRange !== false,
        includeComments: options.includeComments !== false
    };

    return convertNode(root, state);
}

export default convertToESTree;
