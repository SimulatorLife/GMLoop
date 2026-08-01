import { getNonEmptyString } from "../../utils/string.js";

/**
 * Pluggable coercion hooks that doc-comment normalization helpers can invoke
 * to turn loose input values into canonical primitives.
 *
 * Centralising the coercion here lets the doc-comment subsystem stay free of
 * a direct dependency on any specific string utility implementation while
 * still allowing callers (e.g. tests) to inject stricter or more lenient
 * predicates. The default implementation lives in
 * {@link defaultDocCommentStringCoercions}.
 */
export interface DocCommentStringCoercions {
    coerceNonEmptyString(value: string): string | null;
}

/**
 * Default coercion used by doc-comment normalization helpers.
 *
 * Delegates `coerceNonEmptyString` to {@link getNonEmptyString}, which trims
 * the input and returns `null` for empty or non-string results. The
 * descriptor is frozen so downstream code can rely on identity-stable
 * behaviour across calls.
 */
export const defaultDocCommentStringCoercions: DocCommentStringCoercions = Object.freeze({
    coerceNonEmptyString: getNonEmptyString
});

const STRING_TYPE = "string";

/**
 * Remove the surrounding `[` and `]` from an optional parameter token
 * while tolerating nested brackets (e.g. `[[value]=10]`).
 *
 * Tracks bracket depth manually so that a closing bracket nested inside
 * another optional parameter — such as `[a[b]c]` — does not prematurely
 * close the outer token. If the input does not begin with `[`, or the
 * matching `]` is missing, the original string is returned unchanged so
 * malformed inputs are preserved for downstream handling.
 *
 * @param tokenText - A trimmed parameter token, possibly wrapped in `[]`.
 * @returns The token with the outer brackets stripped, or the original
 *          string when it is not a well-formed optional token.
 */
function unwrapOptionalParamToken(tokenText: string): string {
    if (!tokenText.startsWith("[")) {
        return tokenText;
    }

    let bracketDepth = 0;

    for (const [index, char] of Array.from(tokenText).entries()) {
        if (char === "[") {
            bracketDepth += 1;
            continue;
        }

        if (char !== "]") {
            continue;
        }

        bracketDepth -= 1;
        if (bracketDepth === 0) {
            return index > 0 ? tokenText.slice(1, index) : tokenText;
        }
    }

    return tokenText;
}

/**
 * Normalize a parameter token into GML's optional-parameter spelling.
 *
 * Feather documents optional parameters by wrapping the identifier in
 * `*…*` (e.g. `*value*`). This helper rewrites that sentinel form into the
 * canonical `[value]` spelling used by the rest of the doc-comment
 * pipeline. Already-normalized `[value]` tokens and non-string inputs
 * pass through untouched so the function is safe to apply idempotently.
 *
 * @param token - A parameter token, typically the raw text after `/// @param`.
 * @returns The token with the optional sentinel normalized to `[name]`.
 *          Non-string values are returned unchanged.
 */
export function normalizeOptionalParamToken(token: unknown) {
    if (typeof token !== STRING_TYPE) {
        return token;
    }

    const stringToken = token as string;
    const trimmed = stringToken.trim();

    if (/^\[[^\]]+\]$/.test(trimmed)) {
        return trimmed;
    }

    const stripped = trimmed.replaceAll(/^\*+|\*+$/g, "");

    if (stripped === trimmed) {
        return trimmed;
    }

    const normalized = stripped.trim();

    if (normalized.length === 0) {
        return stripped.replaceAll("*", "");
    }

    return `[${normalized}]`;
}

/**
 * Strip the leading and trailing `_` / `$` sentinels that the linter uses
 * to mark synthesized parameter names so they do not collide with real
 * identifiers at lookup time.
 *
 * If the input is not a string, or stripping would leave an empty
 * identifier, the original value is returned. This makes the helper safe
 * to apply to any candidate parameter name without risking an empty
 * string leaking into downstream comparisons.
 *
 * @param name - A candidate parameter name, possibly carrying sentinels.
 * @returns The sentinel-stripped name, or the original value when no
 *          usable identifier remains.
 */
export function stripSyntheticParameterSentinels(name: unknown) {
    if (typeof name !== STRING_TYPE) {
        return name;
    }

    let sanitized = name as string;
    sanitized = sanitized.replace(/^[_$]+/, "");
    sanitized = sanitized.replace(/[_$]+$/, "");

    return sanitized.length > 0 ? sanitized : name;
}

/**
 * Normalize a doc-comment metadata identifier to a stable, comparable form.
 *
 * Combines {@link normalizeOptionalParamToken} (Feather `*name*` → `[name]`)
 * with {@link stripSyntheticParameterSentinels} so that two identifiers
 * that should refer to the same parameter compare equal regardless of how
 * they were originally written. Already-wrapped optional tokens are
 * returned unchanged so the canonical `[name]` spelling is preserved.
 *
 * @param name - A doc-comment metadata identifier.
 * @returns The normalized identifier, or the original value when the
 *          input is not a string.
 */
export function normalizeDocMetadataName(name: unknown) {
    if (typeof name !== STRING_TYPE) {
        return name;
    }

    const optionalNormalized = normalizeOptionalParamToken(name);
    if (typeof optionalNormalized === STRING_TYPE) {
        const normalizedString = optionalNormalized as string;
        if (/^\[[^\]]+\]$/.test(normalizedString)) {
            return normalizedString;
        }

        const sanitized = stripSyntheticParameterSentinels(normalizedString);
        return (sanitized as string).length > 0 ? sanitized : normalizedString;
    }

    return name;
}

/**
 * Extract a canonical parameter name from a raw doc-comment token.
 *
 * Strips surrounding `[ ]`, removes any default value (everything after
 * `=`), and runs the result through {@link normalizeDocMetadataName}.
 * Returns `null` for non-string inputs, empty results, or inputs that
 * normalise to an empty identifier so callers can treat those cases
 * uniformly. Malformed optional tokens that lack a matching `]` are
 * preserved verbatim rather than truncated, which keeps diagnostic
 * reporting faithful to the original source.
 *
 * @param name - A raw parameter name token from a doc comment.
 * @returns The canonical parameter name, or `null` when no usable
 *          identifier can be derived.
 */
export function getCanonicalParamNameFromText(name: unknown): string | null {
    if (typeof name !== STRING_TYPE) {
        return null;
    }

    let trimmed = unwrapOptionalParamToken((name as string).trim());

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex !== -1) {
        trimmed = trimmed.slice(0, equalsIndex);
    }

    const normalized = normalizeDocMetadataName(trimmed.trim());
    if (typeof normalized !== STRING_TYPE) {
        return null;
    }

    const normalizedString = (normalized as string).trim();
    return normalizedString.length > 0 ? normalizedString : null;
}

/**
 * Test whether two doc-comment parameter names refer to the same parameter
 * under the loose matching rules used by the linter.
 *
 * Both sides are normalised through {@link normalizeDocMetadataName},
 * unwrapped if optional, and compared case-insensitively. The loose
 * comparison intentionally ignores optional-bracket spellings and
 * surrounding whitespace so that `[Value]` and `value` (or `*value*`)
 * match. Returns `false` for any input pair that includes a non-string.
 *
 * @param left - First parameter name to compare.
 * @param right - Second parameter name to compare.
 * @returns `true` when both names normalise to the same identifier.
 */
export function docParamNamesLooselyEqual(left: unknown, right: unknown) {
    if (typeof left !== STRING_TYPE || typeof right !== STRING_TYPE) {
        return false;
    }

    const toComparable = (value: unknown) => {
        const normalized = normalizeDocMetadataName(value);
        if (typeof normalized !== STRING_TYPE) {
            return null;
        }

        let trimmed = (normalized as string).trim();
        if (trimmed.length === 0) {
            return null;
        }

        if (trimmed.startsWith("[") && trimmed.endsWith("]") && trimmed.length > 2) {
            trimmed = trimmed.slice(1, -1).trim();
        }

        return trimmed.toLowerCase();
    };

    const leftComp = toComparable(left);
    const rightComp = toComparable(right);

    return leftComp !== null && rightComp !== null && leftComp === rightComp;
}

/**
 * Determine whether {@link name} is the doc-comment spelling of an
 * optional parameter (a non-empty token wrapped in `[ ]`).
 *
 * Only the shape of the token is checked: the function does not look up
 * the corresponding function signature. Non-string inputs always
 * resolve to `false`.
 *
 * @param name - A candidate parameter name token.
 * @returns `true` when the trimmed token is wrapped in `[ ]`.
 */
export function isOptionalParamDocName(name: unknown) {
    if (typeof name !== STRING_TYPE) {
        return false;
    }
    const trimmed = (name as string).trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]");
}

/**
 * Normalize a doc-comment `@param` / `@returns` type annotation into a
 * canonical, non-empty string.
 *
 * Thin wrapper around the configured
 * {@link DocCommentStringCoercions.coerceNonEmptyString} hook, exposed as
 * its own helper so callers do not need to reach into the coercion
 * descriptor directly. The default coercion trims and rejects empty
 * results; custom coercions can be injected for tests or specialised
 * workflows.
 *
 * @param typeText - The raw type annotation text from a doc comment.
 * @param coercions - Optional coercion override; defaults to
 *                    {@link defaultDocCommentStringCoercions}.
 * @returns The coerced type string, or `null` when the input does not
 *          contain a usable type annotation.
 */
export function normalizeParamDocType(
    typeText: string,
    coercions: DocCommentStringCoercions = defaultDocCommentStringCoercions
) {
    return coercions.coerceNonEmptyString(typeText);
}

/**
 * Tracks parameter AST nodes whose original source used an explicit
 * `undefined` default that the synthetic-doc pipeline must preserve
 * verbatim (rather than re-rendering as a normal parameter).
 *
 * Membership is keyed by parameter node identity, so the set can be
 * shared across the doc-comment pipeline without leaking between
 * unrelated ASTs.
 */
export const preservedUndefinedDefaultParameters = new WeakSet<any>();
/**
 * Tracks parameter AST nodes whose doc-comment entry was synthesized
 * by the linter (e.g. for an implicit optional parameter) and therefore
 * must not be re-synthesized or double-counted by downstream passes.
 *
 * Membership is keyed by parameter node identity, mirroring
 * {@link preservedUndefinedDefaultParameters}.
 */
export const synthesizedUndefinedDefaultParameters = new WeakSet<any>();
