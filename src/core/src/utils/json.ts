import { isErrorLike } from "./capability-probes.js";
import { getErrorMessageOrFallback } from "./error.js";
import { assertPlainObject } from "./object.js";
import { isNonEmptyString, toTrimmedString } from "./string.js";

const JSON_PARSE_ERROR_CAPABILITY = Symbol.for("gmloop.json-parse-error");

/**
 * Structural check for values that expose the {@link JsonParseError} contract
 * without relying on `instanceof` checks that fail across execution realms.
 *
 * The guard evaluates three conditions derived from the properties populated
 * by {@link parseJsonWithContext}:
 *   1. The value itself is Error-like (has a `message` string).
 *   2. Its `cause` chain is also Error-like (provides a clean diagnostic path
 *      when the outer error is opaque to cross-realm consumers).
 *   3. A non-blank `description` is present so callers can label the failure
 *      in human-readable terms.
 *
 * The `source` field is accepted but not required—it is only present when the
 * parser could determine the file path of the JSON that failed.
 *
 * @param {unknown} value Candidate value to interrogate.
 * @returns {boolean} `true` when the value matches the structural contract.
 */
function hasJsonParseErrorContract(value: unknown) {
    if (!isErrorLike(value)) {
        return false;
    }

    const candidate = value as Error & {
        cause?: unknown;
        description?: unknown;
        source?: unknown;
    };

    if (!isErrorLike(candidate.cause)) {
        return false;
    }

    const description = toTrimmedString(candidate.description);
    if (description.length === 0) {
        return false;
    }

    const { source } = candidate;
    if (source !== null && typeof source !== "string") {
        return false;
    }

    return true;
}

/**
 * Normalize an arbitrary thrown value into a proper `Error` instance.
 *
 * When the candidate is already Error-like it is returned unchanged so
 * existing error chains (for example wrapped `SyntaxError` or `TypeError`)
 * are preserved. Non-Error values are wrapped in a fresh `Error` using a
 * best-effort message derived from {@link getErrorMessageOrFallback}. The
 * fallback name `"NonErrorThrown"` follows the Node.js convention and
 * allows consumers to distinguish synthetic wrappers from genuine errors.
 *
 * @param {unknown} value Candidate thrown value.
 * @returns {Error} An Error-compatible reference.
 */
function toError(value) {
    if (isErrorLike(value)) {
        return value;
    }

    const message = getErrorMessageOrFallback(value);
    const normalizedMessage = message === "[object Object]" ? "Unknown error" : message;

    const fallback = new Error(normalizedMessage);
    fallback.name = "NonErrorThrown";
    return fallback;
}

type JsonParseErrorOptions = {
    cause?: Error;
    source?: string | null;
    description?: string | null;
};

type JsonParseReviver = Parameters<typeof JSON.parse>[1];

type ParseJsonOptions = {
    source?: unknown;
    description?: unknown;
    reviver?: JsonParseReviver;
};

type ParseJsonObjectOptions = ParseJsonOptions & {
    assertOptions?: Parameters<typeof assertPlainObject>[1];
    createAssertOptions?: (payload: unknown) => Parameters<typeof assertPlainObject>[1];
};

type StringifyJsonForFileOptions = {
    replacer?: Parameters<typeof JSON.stringify>[1];
    space?: Parameters<typeof JSON.stringify>[2];
    includeTrailingNewline?: boolean;
    newline?: string;
};

/**
 * Specialized syntax error raised when JSON parsing fails. The wrapper keeps
 * the original `cause` intact (when supported) while also carrying extra
 * metadata about the source being parsed so callers can produce actionable
 * error messages without re-threading context through every call site.
 */
export class JsonParseError extends SyntaxError {
    source?: string | null;
    description?: string;
    override cause?: Error;

    constructor(message, { cause, source, description }: JsonParseErrorOptions = {}) {
        super(message, cause ? { cause } : undefined);
        this.name = "JsonParseError";
        if (cause !== undefined) {
            this.cause = cause;
        }
        if (source !== undefined) {
            this.source = source;
        }
        if (description !== undefined) {
            this.description = description;
        }

        Object.defineProperty(this, JSON_PARSE_ERROR_CAPABILITY, {
            value: true,
            enumerable: false,
            configurable: true
        });
    }
}

/**
 * Check whether a thrown value matches the {@link JsonParseError} contract.
 *
 * The guard honours the symbol capability applied by {@link JsonParseError}
 * instances so downstream collaborators can opt-in by branding their own
 * facades with {@link Symbol.for "gmloop.json-parse-error"}.
 * When the capability is absent, the function falls back to structural checks
 * that mirror the properties populated by {@link parseJsonWithContext},
 * allowing callers to branch on enriched metadata without relying on
 * constructor names.
 *
 * @param {unknown} value Candidate error object to interrogate.
 * @returns {value is JsonParseError} `true` when the value exposes the
 *     expected shape for {@link JsonParseError}.
 */
export function isJsonParseError(value) {
    if (value?.[JSON_PARSE_ERROR_CAPABILITY]) {
        return true;
    }

    return hasJsonParseErrorContract(value);
}

/**
 * Normalize a human-readable label for the JSON payload being parsed.
 *
 * Falls back to `"JSON"` when the description is missing or blank, keeping
 * error messages grammatical even when callers omit the label parameter.
 *
 * @param {unknown} description Candidate label string.
 * @returns {string} Non-empty normalized description.
 */
function normalizeDescription(description) {
    const normalized = toTrimmedString(description);

    return normalized.length > 0 ? normalized : "JSON";
}

/**
 * Normalize the source path attached to a parse error.
 *
 * Accepts `null` (returns `null`) or strings that survive
 * {@link isNonEmptyString}. Values that fail both checks are coerced via
 * `String(source)` so unexpected types still contribute to error messages.
 * An empty string after coercion is returned as `null` to keep the caller
 * from adding a redundant "from" clause to the message.
 *
 * @param {unknown} source Candidate file path or description.
 * @returns {string | null} Normalized source string or `null`.
 */
function normalizeSource(source) {
    if (source == null) {
        return null;
    }
    if (isNonEmptyString(source)) {
        return source;
    }
    try {
        return String(source);
    } catch {
        return "";
    }
}

/**
 * Extract a human-readable message string from an error-like candidate.
 *
 * Returns the trimmed `message` property when present and non-empty;
 * otherwise yields `"Unknown error"` so callers always have a string to
 * append or log without additional guards.
 *
 * @param {unknown} error Candidate error value.
 * @returns {string} The error message or a safe fallback.
 */
function extractErrorDetails(error) {
    const normalized = toTrimmedString(error?.message);

    return normalized.length > 0 ? normalized : "Unknown error";
}

/**
 * Narrow a candidate to a plain object when it is object-like, otherwise
 * return `undefined`.
 *
 * Centralizes the pattern of accepting union types that include
 * non-object branches (for example `T | null | undefined`) and producing
 * the narrowed form or a safe sentinel so callers can avoid repeating the
 * `typeof` guard at each call site.
 *
 * @template T
 * @param {T | null | undefined} candidate Value to narrow.
 * @returns {T | undefined} The narrowed object or `undefined`.
 */
function toObjectOrUndefined(candidate) {
    return candidate && typeof candidate === "object" ? candidate : undefined;
}

/**
 * Produce a context label for the payload that caused a JSON serialization
 * failure.
 *
 * The function maps `undefined`, `function`, and `symbol` inputs to
 * human-readable labels so that error messages read grammatically without
 * callers having to inline the same conditional tree. All other types
 * (including `null`, numbers, and objects) fall through to `"provided
 * payload"` to keep the label informative while avoiding repeated type
 * checks downstream.
 *
 * @param {unknown} payload Value that failed to serialize.
 * @returns {string} Context label for the error message.
 */
function describePayloadForSerializationError(payload) {
    if (payload === undefined) {
        return "undefined payload";
    }

    const type = typeof payload;

    if (type === "function") {
        return "function payload";
    }

    if (type === "symbol") {
        return "symbol payload";
    }

    return "provided payload";
}

/**
 * Parse a JSON payload while annotating any failures with high-level context.
 *
 * The helper mirrors `JSON.parse` semantics but decorates thrown errors with
 * {@link JsonParseError}, ensuring the resulting message includes the
 * normalized description/source and the original failure details. This keeps
 * diagnostics stable even when upstream code throws non-`Error` values or
 * provides blank description strings.
 *
 * @param {string} text Raw JSON text to parse.
 * @param {{
 *     source?: string | unknown,
 *     description?: string | unknown,
 *     reviver?: (this: any, key: string, value: any) => any
 * }} [options] Parsing options. `source` is surfaced in error messages to
 *     highlight where the JSON originated. `description` labels the payload
 *     (defaults to "JSON"), and `reviver` mirrors the native `JSON.parse`
 *     reviver hook.
 * @returns {any} Parsed JavaScript value when `text` is valid JSON.
 * @throws {JsonParseError} When parsing fails. The error exposes `cause`,
 *     `source`, and `description` properties when available.
 */
export function parseJsonWithContext(text, options: ParseJsonOptions = {}) {
    const { source, description, reviver } = options;
    try {
        return JSON.parse(text, reviver);
    } catch (error) {
        const cause = toError(error);
        const normalizedDescription = normalizeDescription(description);
        const normalizedSource = normalizeSource(source);
        const details = extractErrorDetails(cause);
        const locationSuffix = normalizedSource ? ` from ${normalizedSource}` : "";
        const message = `Failed to parse ${normalizedDescription}${locationSuffix}: ${details}`;
        throw new JsonParseError(message, {
            cause,
            source: normalizedSource ?? undefined,
            description: normalizedDescription
        });
    }
}

/**
 * Parse a JSON payload that is expected to yield a plain object.
 *
 * The helper reuses {@link parseJsonWithContext} to surface enriched syntax
 * errors and then validates the resulting value with
 * {@link assertPlainObject}. Callers can supply either static assertion
 * options via {@link assertOptions} or compute them dynamically based on the
 * parsed payload via {@link createAssertOptions}. When both are provided, the
 * dynamic options take precedence while still layering on top of the static
 * bag so shared settings like `allowNullPrototype` remain in effect.
 *
 * @param {string} text Raw JSON text to parse.
 * @param {{
 *   source?: string,
 *   description?: string,
 *   reviver?: (this: any, key: string, value: any) => any,
 *   assertOptions?: Parameters<typeof assertPlainObject>[1],
 *   createAssertOptions?: (payload: unknown) => Parameters<typeof assertPlainObject>[1]
 * }} [options]
 * @returns {Record<string, unknown>} Parsed JSON object.
 */
export function parseJsonObjectWithContext(text, options: ParseJsonObjectOptions = {}) {
    const { source, description, reviver, assertOptions, createAssertOptions } = options;

    const payload = parseJsonWithContext(text, {
        source,
        description,
        reviver
    });

    const baseOptions = toObjectOrUndefined(assertOptions);
    const dynamicOptions = toObjectOrUndefined(
        typeof createAssertOptions === "function" ? createAssertOptions(payload) : undefined
    );

    const mergedOptions = baseOptions || dynamicOptions ? { ...baseOptions, ...dynamicOptions } : undefined;

    return assertPlainObject(payload, mergedOptions);
}

/**
 * Serialize a JSON payload for file output while normalizing trailing
 * newlines. Helpers across the CLI and plugin previously reimplemented this
 * behaviour, often appending "\n" manually after JSON.stringify. Centralizing
 * the logic ensures all call sites respect the same newline semantics and keeps
 * indentation handling in one place.
 *
 * @param {unknown} [payload] Data structure to serialize.
 * @param {{
 *   replacer?: Parameters<typeof JSON.stringify>[1],
 *   space?: Parameters<typeof JSON.stringify>[2],
 *   includeTrailingNewline?: boolean,
 *   newline?: string
 * }} [options]
 * @returns {string} Stringified JSON with optional trailing newline.
 */
export function stringifyJsonForFile(payload?: unknown, options?: StringifyJsonForFileOptions) {
    const { replacer = null, space = 0, includeTrailingNewline = true, newline = "\n" } = options ?? {};

    const serialized = JSON.stringify(payload, replacer, space);

    if (typeof serialized !== "string") {
        const payloadDescription = describePayloadForSerializationError(payload);

        throw new TypeError(`Unable to serialize ${payloadDescription} to JSON. JSON.stringify returned undefined.`);
    }

    if (!includeTrailingNewline) {
        return serialized;
    }

    const terminator = isNonEmptyString(newline) ? newline : "\n";

    if (serialized.endsWith(terminator)) {
        return serialized;
    }

    return `${serialized}${terminator}`;
}
