import process from "node:process";

import { Core } from "@gmloop/core";

import { asErrorLike } from "../shared/error-guards.js";

const DEFAULT_INDENT = "  ";

const CLI_USAGE_ERROR_BRAND = Symbol.for("gmloop/cli-usage-error");

export interface ErrorWithMetadata extends Error {
    usage?: string | null;
    cause?: unknown;
    stack?: string;
    code?: string | number;
    [CLI_USAGE_ERROR_BRAND]?: boolean;
}

interface CliUsageErrorOptions {
    usage?: string | null;
}

interface CliErrorDetails {
    message: string;
    name: string;
    code?: string;
    stack?: Array<string>;
}

interface CliErrorLinesOptions {
    prefix?: string;
    formattedError?: string;
    usage?: string | null;
}

export interface HandleCliErrorOptions {
    exitCode?: number;
    prefix?: string;
}

function brandCliUsageError(error: ErrorWithMetadata): void {
    if (error[CLI_USAGE_ERROR_BRAND]) {
        return;
    }

    Object.defineProperty(error, CLI_USAGE_ERROR_BRAND, {
        configurable: true,
        enumerable: false,
        value: true,
        writable: false
    });
}

export function markAsCliUsageError(error: unknown, { usage }: CliUsageErrorOptions = {}): ErrorWithMetadata | null {
    const errorLike = asErrorLike(error);
    if (!errorLike) {
        return null;
    }

    const branded = errorLike as ErrorWithMetadata;
    brandCliUsageError(branded);
    if (usage !== undefined || !("usage" in branded)) {
        branded.usage = usage ?? null;
    }

    return branded;
}

function indentBlock(text: string, indent = DEFAULT_INDENT): string {
    return text
        .split("\n")
        .map((line) => `${indent}${line}`)
        .join("\n");
}

export function isCliUsageError(error: unknown): error is ErrorWithMetadata {
    const branded = asErrorLike(error) as ErrorWithMetadata | null;
    return Boolean(branded?.[CLI_USAGE_ERROR_BRAND]);
}

function formatSection(label: string, content: string | null): string | null {
    if (!content) {
        return null;
    }

    return `${label}:\n${content}`;
}

function extractStackBody(stack: string | null): string | null {
    if (typeof stack !== "string") {
        return null;
    }

    const [, ...stackLines] = stack.split("\n");
    if (stackLines.length === 0) {
        return null;
    }

    const stackBody = stackLines.map((line) => line.trimEnd()).join("\n");
    return stackBody || null;
}

function formatAggregateErrors(error: unknown, seen: Set<unknown>): string | null {
    if (!Core.isAggregateErrorLike(error)) {
        return null;
    }

    const aggregate = error as { errors: Array<unknown> };
    const mapped: Array<string> = aggregate.errors.map((entry) => formatErrorValue(entry, seen));
    const formatted = Core.compactArray(mapped).map((text) => indentBlock(`- ${text.replaceAll("\n", "\n  ")}`));

    if (formatted.length === 0) {
        return null;
    }

    return formatSection("Errors", formatted.join("\n"));
}

function formatErrorCause(cause: unknown, seen: Set<unknown>): string | null {
    if (!cause) {
        return null;
    }

    const text = formatErrorValue(cause, seen);
    return formatSection("Caused by", indentBlock(text));
}

function formatErrorHeader(error: ErrorWithMetadata): string {
    const name = Core.toTrimmedString(error.name);
    const message = Core.toTrimmedString(error.message);

    if (isCliUsageError(error)) {
        return message;
    }

    if (name && message) {
        return message.toLowerCase().startsWith(name.toLowerCase()) ? message : `${name}: ${message}`;
    }

    if (message) {
        return message;
    }

    if (name) {
        return name;
    }

    const headerError = error as ErrorWithMetadata;
    if (typeof headerError.toString === "function") {
        return headerError.toString();
    }

    return "";
}

function formatErrorObject(error: ErrorWithMetadata, seen: Set<unknown>): string {
    if (seen.has(error)) {
        return "[Circular error reference]";
    }

    seen.add(error);

    const errored = error;
    const isUsageError = isCliUsageError(error);
    const isParseError = Core.isGmlParseError(error);
    const stack = !isUsageError && !isParseError && typeof errored.stack === "string" ? errored.stack : null;
    const sections = Core.compactArray([
        formatErrorHeader(error),
        extractStackBody(stack),
        formatErrorCause(error.cause, seen),
        formatAggregateErrors(error, seen)
    ]);

    if (sections.length === 0 && stack) {
        return stack;
    }

    return sections.join("\n");
}

function formatPlainObject(value: object, seen: Set<unknown>): string {
    if (seen.has(value)) {
        return "[Circular value reference]";
    }

    seen.add(value);

    try {
        return JSON.stringify(value);
    } catch {
        const tagName = Core.getObjectTagName(value);
        return tagName ? `[${tagName}]` : "[object Object]";
    }
}

function formatErrorValue(value: unknown, seen: Set<unknown>): string {
    if (value == null) {
        return "Unknown error";
    }

    if (typeof value === "string") {
        return value;
    }

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
        return String(value);
    }

    const errorLike = asErrorLike(value);
    if (errorLike) {
        return formatErrorObject(errorLike as ErrorWithMetadata, seen);
    }

    if (value && typeof value === "object") {
        return formatPlainObject(value, seen);
    }

    if (typeof value === "symbol") {
        return value.toString();
    }

    if (typeof value === "function") {
        return value.name ? `[Function ${value.name}]` : "[Function]";
    }

    return "[unknown value]";
}

export function formatCliError(error: unknown): string {
    return formatErrorValue(error, new Set());
}

export class CliUsageError extends Error {
    usage: string | null;
    override cause?: unknown;

    constructor(message: string, { usage }: CliUsageErrorOptions = {}) {
        super(message);
        this.name = "CliUsageError";
        this.usage = usage ?? null;
        markAsCliUsageError(this, { usage });
    }
}

function normalizeStackLines(stack: string | undefined): Array<string> | null {
    if (typeof stack !== "string") {
        return null;
    }

    const lines = stack.split("\n").map((line) => line.trimEnd());
    return lines.some((line) => line.length > 0) ? lines : null;
}

function resolveErrorName(error: unknown): string {
    const errorLike = asErrorLike(error);
    const explicitName = Core.toTrimmedString(errorLike?.name);
    if (explicitName) {
        return explicitName;
    }

    const tagName = Core.getObjectTagName(error);
    if (tagName) {
        return tagName;
    }

    return "Error";
}

export function createCliErrorDetails(
    error: unknown,
    { fallbackMessage = "Unknown error" }: { fallbackMessage?: string } = {}
): CliErrorDetails {
    const code = Core.getErrorCode(error);
    const stackLines = normalizeStackLines(asErrorLike(error)?.stack);

    return {
        message: Core.getErrorMessage(error, { fallback: fallbackMessage }),
        name: resolveErrorName(error),
        ...(code ? { code } : {}),
        ...(stackLines ? { stack: stackLines } : {})
    };
}

function resolveCliErrorUsage(error: unknown): string | null {
    const usage = asErrorLike(error)?.usage;
    return typeof usage === "string" ? usage : null;
}

function buildCliErrorLines({ prefix, formattedError, usage }: CliErrorLinesOptions): Array<string> {
    const lines: Array<string> = [];
    if (prefix) {
        lines.push(prefix);
    }

    if (formattedError) {
        lines.push(formattedError);
    }

    if (usage) {
        return lines.length > 0 ? [...lines, "", usage] : [usage];
    }

    return lines;
}

export function handleCliError(error: unknown, { exitCode = 1, prefix }: HandleCliErrorOptions = {}): never {
    const normalizedPrefix = isCliUsageError(error) ? undefined : prefix;
    const formatted = formatCliError(error);
    const usage = resolveCliErrorUsage(error);
    const lines = buildCliErrorLines({
        prefix: normalizedPrefix,
        formattedError: formatted,
        usage
    });

    const output = lines.join("\n");
    if (output) {
        console.error(output);
    }

    process.exit(exitCode);
}
