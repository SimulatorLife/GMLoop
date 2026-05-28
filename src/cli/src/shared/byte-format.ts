import { Buffer } from "node:buffer";

import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "./env-configured-integer.js";

const {
    callWithFallback,
    clamp,
    coercePositiveInteger,
    createNumericTypeErrorFormatter,
    describeValueForError,
    isFiniteNumber,
    resolveIntegerOption
} = Core;

const BYTE_UNITS = Object.freeze(["B", "KB", "MB", "GB", "TB", "PB"]);
const DEFAULT_BYTE_FORMAT_RADIX = 1024;
const BYTE_FORMAT_RADIX_ENV_VAR = "PRETTIER_PLUGIN_GML_BYTE_FORMAT_RADIX";

const createRadixErrorMessage = (received: unknown): string =>
    `Byte format radix must be a positive integer (received ${describeValueForError(received)}).`;

const createRadixTypeErrorMessage = createNumericTypeErrorFormatter("Byte format radix");

const coerce = (value: unknown, context = {}) => {
    const opts = { ...context, createErrorMessage: createRadixErrorMessage };
    return coercePositiveInteger(value, opts);
};

const state = createIntegerEnvConfiguredValue({
    defaultValue: DEFAULT_BYTE_FORMAT_RADIX,
    envVar: BYTE_FORMAT_RADIX_ENV_VAR,
    coerce,
    typeErrorMessage: createRadixTypeErrorMessage
});

function getDefaultByteFormatRadix(): number | undefined {
    return state.get();
}

function setDefaultByteFormatRadix(value?: unknown): number | undefined {
    return state.set(value);
}

function resolveByteFormatRadix(
    rawValue?: unknown,
    options: Record<string, unknown> & {
        defaultValue?: number;
        defaultRadix?: number;
    } = {}
): number | null | undefined {
    const fallback = options.defaultRadix ?? options.defaultValue ?? state.get();
    return resolveIntegerOption(rawValue, {
        defaultValue: fallback,
        coerce,
        typeErrorMessage: createRadixTypeErrorMessage,
        blankStringReturnsDefault: true
    });
}

function applyByteFormatRadixEnvOverride(env?: NodeJS.ProcessEnv): number | undefined {
    return state.applyEnvOverride(env);
}

applyByteFormatRadixEnvOverride();

type NumericLike = number | bigint;

export interface FormatByteSizeOptions {
    decimals?: number;
    decimalsForBytes?: number;
    separator?: string;
    trimTrailingZeros?: boolean;
    radix?: number | string;
}

export interface FormatByteSizeDisplayOptions {
    decimals?: number;
    decimalsForBytes?: number;
    separator?: string;
    invalidValue?: string;
    allowNegative?: boolean;
}

function normalizeByteCount(value: NumericLike): number {
    if (typeof value === "bigint") {
        const numericValue = Number(value);

        if (!isFiniteNumber(numericValue)) {
            return value > 0n ? Number.MAX_VALUE : 0;
        }

        return clamp(numericValue, 0, Number.POSITIVE_INFINITY);
    }

    if (!isFiniteNumber(value)) {
        return 0;
    }

    return clamp(value, 0, Number.POSITIVE_INFINITY);
}

function resolveRadixOverride(radix: number | string | undefined, defaultRadix: number): number {
    if (radix === undefined) {
        return defaultRadix;
    }

    return callWithFallback(
        () => {
            const resolved = resolveByteFormatRadix(radix, { defaultRadix });
            return typeof resolved === "number" ? resolved : defaultRadix;
        },
        { fallback: defaultRadix }
    );
}

function normalizeDecimalPlaces(value: number): number {
    if (!isFiniteNumber(value)) {
        return 0;
    }

    return clamp(value, 0, Number.POSITIVE_INFINITY);
}

function formatByteSize(
    bytes: NumericLike,
    { decimals = 1, decimalsForBytes = 0, separator = "", trimTrailingZeros = false, radix }: FormatByteSizeOptions = {}
): string {
    let value = normalizeByteCount(bytes);
    const defaultRadix = getDefaultByteFormatRadix() ?? DEFAULT_BYTE_FORMAT_RADIX;
    const resolvedRadix = resolveRadixOverride(radix, defaultRadix);
    const maxUnitIndex = BYTE_UNITS.length - 1;
    let unitIndex = 0;

    for (; unitIndex < maxUnitIndex && value >= resolvedRadix; unitIndex += 1) {
        value /= resolvedRadix;
    }

    const decimalPlaces = normalizeDecimalPlaces(unitIndex === 0 ? decimalsForBytes : decimals);

    let formattedValue = value.toFixed(decimalPlaces);

    if (trimTrailingZeros && decimalPlaces > 0) {
        formattedValue = formattedValue.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, "$1");
    }

    const unitSeparator = typeof separator === "string" ? separator : "";

    return `${formattedValue}${unitSeparator}${BYTE_UNITS[unitIndex]}`;
}

function formatByteSizeDisplay(
    bytes: number | null | undefined,
    {
        decimals = 2,
        decimalsForBytes = 0,
        separator = "",
        invalidValue = "N/A",
        allowNegative = false
    }: FormatByteSizeDisplayOptions = {}
): string {
    if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) {
        return invalidValue;
    }

    if (!allowNegative && bytes < 0) {
        return invalidValue;
    }

    const sign = allowNegative && bytes < 0 ? "-" : "";
    const absoluteBytes = allowNegative ? Math.abs(bytes) : bytes;

    return `${sign}${formatByteSize(absoluteBytes, { decimals, decimalsForBytes, separator })}`;
}

function formatBytes(text: string): string {
    const size = Buffer.byteLength(text, "utf8");
    return formatByteSize(size, { decimals: 1 });
}

export {
    applyByteFormatRadixEnvOverride,
    BYTE_FORMAT_RADIX_ENV_VAR,
    DEFAULT_BYTE_FORMAT_RADIX,
    formatBytes,
    formatByteSize,
    formatByteSizeDisplay,
    getDefaultByteFormatRadix,
    resolveByteFormatRadix,
    setDefaultByteFormatRadix
};
