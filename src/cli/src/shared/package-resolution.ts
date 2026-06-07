import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

const {
    describeValueWithArticle,
    getErrorMessageOrFallback,
    getNonEmptyTrimmedString,
    isPlainObject,
    parseJsonObjectWithContext
} = Core;

const isPackageJsonRecord = (value: unknown): value is Record<string, unknown> => isPlainObject(value);
const describePackageJsonValueWithArticle = describeValueWithArticle as (
    value: unknown,
    options?: { emptyStringLabel?: string }
) => string;

function describePackageJsonValue(value: unknown): string {
    return describePackageJsonValueWithArticle(value, { emptyStringLabel: "an empty string" });
}

function buildPackageJsonObjectErrorMessage(packageJsonPath: string, payload: unknown): string {
    return `Expected package.json to contain an object at ${packageJsonPath}. Received ${describePackageJsonValue(
        payload
    )}.`;
}

function assertPackageJsonStringField(
    record: Record<string, unknown>,
    fieldName: string,
    packageJsonPath: string
): void {
    if (!Object.hasOwn(record, fieldName)) {
        return;
    }

    const rawValue = record[fieldName];
    const normalized = getNonEmptyTrimmedString(rawValue);
    if (!normalized) {
        throw new TypeError(
            `package.json field '${fieldName}' must be a non-empty string at ${packageJsonPath}. ` +
                `Received ${describePackageJsonValue(rawValue)}.`
        );
    }
}

function validatePackageJsonShape(record: Record<string, unknown>, packageJsonPath: string): Record<string, unknown> {
    assertPackageJsonStringField(record, "name", packageJsonPath);
    assertPackageJsonStringField(record, "version", packageJsonPath);
    return record;
}

export interface SourceDescriptor {
    root: string;
    packageName: string | null;
    packageJson: Record<string, unknown> | null;
}

/**
 * Parse and validate a package.json payload that has already been read from disk.
 *
 * @param contents Raw package.json text.
 * @param packageJsonPath Source path used in validation errors.
 * @returns The validated package.json object.
 */
export function parsePackageJsonContents(contents: string, packageJsonPath: string): Record<string, unknown> {
    const parsed: unknown = parseJsonObjectWithContext(contents, {
        source: packageJsonPath,
        description: "package.json",
        createAssertOptions: (payload) => ({
            errorMessage: buildPackageJsonObjectErrorMessage(packageJsonPath, payload)
        })
    });

    if (!isPackageJsonRecord(parsed)) {
        throw new TypeError(buildPackageJsonObjectErrorMessage(packageJsonPath, parsed));
    }

    return validatePackageJsonShape(parsed, packageJsonPath);
}

/**
 * Read a validated string field from a parsed package.json object.
 *
 * @param packageJson Parsed package.json object.
 * @param fieldName Field name to read.
 * @returns The normalized string value, or null when the field is absent.
 */
export function getPackageJsonStringField(packageJson: Record<string, unknown>, fieldName: string): string | null {
    if (!Object.hasOwn(packageJson, fieldName)) {
        return null;
    }

    return getNonEmptyTrimmedString(packageJson[fieldName]);
}

/**
 * Resolve a candidate root path to a source descriptor.
 * Returns null if the provided root is falsy.
 */
export function resolveCandidateRoot(candidateRoot: string | null | undefined): SourceDescriptor | null {
    if (!candidateRoot) {
        return null;
    }

    const normalized = path.resolve(candidateRoot);
    return { root: normalized, packageName: null, packageJson: null };
}

/**
 * Read and parse a package.json file from the given path.
 */
export async function readPackageJson(packageJsonPath: string): Promise<Record<string, unknown>> {
    const contents = await fs.readFile(packageJsonPath, "utf8");
    return parsePackageJsonContents(contents, packageJsonPath);
}

/**
 * Resolve the path to a package's package.json file using Node's native ESM
 * resolver instead of the legacy CommonJS `createRequire(...).resolve` bridge.
 * Throws if the package cannot be resolved.
 */
export function resolvePackageJsonPath(packageName: string, context: string): string {
    try {
        const packageJsonUrl = import.meta.resolve(`${packageName}/package.json`);
        return fileURLToPath(packageJsonUrl);
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        throw new Error(`Unable to resolve ${context} package '${packageName}'. (${message})`, { cause: error });
    }
}
