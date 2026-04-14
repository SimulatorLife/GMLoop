import { Buffer } from "node:buffer";

import { Core } from "@gmloop/core";

import { createIntegerRuntimeOptionState } from "./integer-runtime-option-state.js";

const { callWithFallback, clamp, coercePositiveInteger, isFiniteNumber } = Core;

const BYTE_UNITS = Object.freeze(["B", "KB", "MB", "GB", "TB", "PB"]);
const DEFAULT_BYTE_FORMAT_RADIX = 1024;
const BYTE_FORMAT_RADIX_ENV_VAR = "PRETTIER_PLUGIN_GML_BYTE_FORMAT_RADIX";

const runtimeOptionState = createIntegerRuntimeOptionState({
    defaultValue: DEFAULT_BYTE_FORMAT_RADIX,
    envVar: BYTE_FORMAT_RADIX_ENV_VAR,
    optionLabel: "Byte format radix",
    createValueErrorMessage: (receivedDescription) =>
        `Byte format radix must be a positive integer (received ${receivedDescription}).`,
    coerceInteger: coercePositiveInteger
});

function getDefaultByteFormatRadix(): number | undefined {
    return runtimeOptionState.get();
}

function setDefaultByteFormatRadix(value?: unknown): number | undefined {
    return runtimeOptionState.set(value);
}

function resolveByteFormatRadix(
    rawValue?: unknown,
    options: Record<string, unknown> & {
        defaultValue?: number;
        defaultRadix?: number;
    } = {}
): number | null | undefined {
    return runtimeOptionState.resolve(rawValue, {
        defaultValue: options.defaultValue,
        defaultOverride: options.defaultRadix
    });
}

function applyByteFormatRadixEnvOverride(env?: NodeJS.ProcessEnv): number | undefined {
    return runtimeOptionState.applyEnvOverride(env);
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
            return 0;
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

    const decimalPlaces = clamp(unitIndex === 0 ? decimalsForBytes : decimals, 0, Number.POSITIVE_INFINITY);

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
