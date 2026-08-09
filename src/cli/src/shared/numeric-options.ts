import { Core } from "@gmloop/core";

const { formatTypeValidationError } = Core;

type ResolveIntegerOptionOptions = {
    defaultValue?: number;
    coerce: (value: number, options: { received: unknown }) => number;
    parseString?: (text: string, radix: number) => number;
    typeErrorMessage?: string | ((type: string) => string);
    blankStringReturnsDefault?: boolean;
};

type ParseStringOptionParams = {
    defaultValue?: number;
    coerce: ResolveIntegerOptionOptions["coerce"];
    parseString: NonNullable<ResolveIntegerOptionOptions["parseString"]>;
    blankStringReturnsDefault?: boolean;
};

const DECIMAL_INTEGER_PATTERN = /^[-+]?\d+/u;
const DECIMAL_RADIX = 10;

const DEFAULT_PARSE_STRING = (text) => {
    const match = DECIMAL_INTEGER_PATTERN.exec(String(text));
    return match ? Number(match[0]) : Number.NaN;
};

function parseStringOption(
    rawValue: string,
    { defaultValue, coerce, parseString, blankStringReturnsDefault }: ParseStringOptionParams
) {
    const trimmed = rawValue.trim();
    if (trimmed === "" && blankStringReturnsDefault) {
        return defaultValue;
    }

    const parsed = parseString(trimmed, DECIMAL_RADIX);
    return coerce(parsed, { received: `'${rawValue}'` });
}

function createTypeErrorMessage(typeErrorMessage, rawValue) {
    const type = typeof rawValue;

    if (typeof typeErrorMessage === "function") {
        return typeErrorMessage(type);
    }

    if (typeof typeErrorMessage === "string") {
        return typeErrorMessage;
    }

    return formatTypeValidationError("a number", rawValue);
}

/**
 * Coerce configuration values into integers while supporting number and
 * string inputs. This underpins option handling across the CLI where
 * command-line flags, environment variables, or config files may all supply
 * the same setting. Callers supply the {@link coerce} callback to define the
 * exact numeric bounds or post-processing.
 *
 * This helper previously lived in the shared core utilities even though the
 * CLI was the only consumer (byte-format radii, progress bar widths, VM
 * evaluation timeouts, sample limits, env-configured integers). Co-locating it
 * with the rest of the CLI helpers keeps the core package focused on
 * cross-environment primitives while preserving the behaviour relied upon by
 * the command surface.
 *
 * Edge cases to be aware of:
 * - `undefined`, `null`, and (optionally) blank strings resolve to the
 *   `defaultValue` so that omitted CLI flags behave like unset config keys.
 * - String inputs are trimmed before parsing to keep incidental whitespace from
 *   tripping validation.
 * - Non-string/non-number values raise a `TypeError`, with the message either
 *   caller-provided or auto-generated for debugging clarity.
 *
 * @param {unknown} rawValue Incoming option value.
 * @param {object} [options]
 * @param {number} [options.defaultValue] Fallback when the option is missing.
 * @param {(value: number, options: object) => number} options.coerce Function
 *        invoked with the parsed number and context to validate range or
 *        return alternate values.
 * @param {(text: string) => number} [options.parseString] Custom parser for
 *        string inputs, e.g. to support hex or binary notation. Defaults to
 *        {@link DEFAULT_PARSE_STRING}.
 * @param {string | ((type: string) => string)} [options.typeErrorMessage]
 *        Overrides the error message when a non-number, non-string value is
 *        provided.
 * @param {boolean} [options.blankStringReturnsDefault=true] When `true`, blank
 *        strings short-circuit to the default; otherwise they are parsed.
 * @returns {number | undefined} The coerced numeric option value.
 */
export function resolveIntegerOption(rawValue: unknown, options: ResolveIntegerOptionOptions | undefined) {
    const normalizedOptions = options ?? { coerce: () => Number.NaN };
    const {
        defaultValue,
        coerce,
        parseString = DEFAULT_PARSE_STRING,
        typeErrorMessage,
        blankStringReturnsDefault = true
    } = normalizedOptions;

    if (rawValue == null) {
        return defaultValue;
    }

    if (typeof rawValue === "number") {
        return coerce(rawValue, { received: rawValue });
    }

    if (typeof rawValue === "string") {
        return parseStringOption(rawValue, {
            defaultValue,
            coerce,
            parseString,
            blankStringReturnsDefault
        });
    }

    throw new TypeError(createTypeErrorMessage(typeErrorMessage, rawValue));
}

/**
 * Create a type error message formatter for numeric options. Centralizes the
 * pattern used across CLI modules where option validators need to report when
 * a non-numeric type is provided. The returned function accepts the type name
 * and yields a descriptive error message.
 *
 * @param {string} label Human-readable option name (e.g., "Progress bar width",
 *        "VM evaluation timeout").
 * @returns {(type: string) => string} Formatter that accepts a type name and
 *          returns the error message.
 */
export function createNumericTypeErrorFormatter(label) {
    return (type) => `${label} must be provided as a number (received type '${type}').`;
}
