import { type Doc, doc } from "prettier";

const { builders, utils } = doc;
const rawJoin = builders.join;
const { willBreak } = utils;
const { breakParent, line, hardline, softline, lineSuffixBoundary } = builders;

/**
 * Normalized child shape accepted by the Prettier doc builder helpers.
 *
 * The printer frequently assembles docs from heterogeneous values that may
 * include falsy placeholders. This type models the permissive inputs that can
 * be sanitized into valid Prettier {@link Doc} nodes.
 */
export type DocChild = Doc | DocChild[] | boolean | null | undefined;

/**
 * Sanitize each element of a {@link DocChild} array into a valid
 * {@link Doc} array. Uses pre-sized allocation and an indexed loop to
 * avoid per-element callback overhead on the hot printer path.
 */
function sanitizeArray(parts: DocChild[]): Doc[] {
    const length = parts.length;
    const result: Doc[] = [];
    result.length = length;
    for (let i = 0; i < length; i++) {
        result[i] = sanitizeDocChild(parts[i]);
    }
    return result;
}

function sanitizeDocChild(child: DocChild): Doc {
    if (Array.isArray(child)) {
        return sanitizeArray(child);
    }

    if (child == null || child === false) {
        return "";
    }

    if (child === true) {
        return "true";
    }

    return child;
}

/**
 * Concatenate doc fragments while gracefully discarding unsupported falsy
 * values.
 */
export function concat(parts: DocChild | DocChild[]): Doc {
    if (!Array.isArray(parts)) {
        return [sanitizeDocChild(parts)];
    }

    return sanitizeArray(parts);
}

/**
 * Join doc fragments with a separator, ensuring every element is a valid doc
 * node.
 */
export function join(separator: Doc, parts: DocChild | DocChild[]): Doc {
    if (!Array.isArray(parts)) {
        return rawJoin(separator, [sanitizeDocChild(parts)]);
    }

    return rawJoin(separator, sanitizeArray(parts));
}

/**
 * Wrap a doc fragment in a Prettier group after sanitizing its children.
 */
export function group(parts: DocChild, opts?: Record<string, unknown>): Doc {
    return builders.group(sanitizeDocChild(parts), opts);
}

/**
 * Construct a conditional group while sanitizing each branch.
 */
export function conditionalGroup(parts: DocChild[], opts?: Record<string, unknown>): Doc {
    return builders.conditionalGroup(sanitizeArray(parts), opts);
}

/**
 * Increase indentation for the provided doc fragment after sanitization.
 */
export function indent(parts: DocChild): Doc {
    return builders.indent(sanitizeDocChild(parts));
}

/**
 * Render alternate docs depending on whether a line break occurs.
 */
export function ifBreak(breakContents: DocChild, flatContents?: DocChild, opts?: Record<string, unknown>): Doc {
    return builders.ifBreak(sanitizeDocChild(breakContents), sanitizeDocChild(flatContents ?? ""), opts);
}

/**
 * Attach a sanitized doc fragment to the current line suffix.
 */
export function lineSuffix(parts: DocChild): Doc {
    return builders.lineSuffix(sanitizeDocChild(parts));
}

export { breakParent, hardline, line, lineSuffixBoundary, softline, willBreak };
