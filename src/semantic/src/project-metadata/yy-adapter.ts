import fs from "node:fs";
import path from "node:path";

import { Yy } from "@bscotch/yy";
import { Core } from "@gmloop/core";

const PROJECT_METADATA_PARSE_ERROR = "ProjectMetadataParseError";
const PROJECT_METADATA_SCHEMA_VALIDATION_ERROR = "ProjectMetadataSchemaValidationError";

const RESOURCE_TYPE_TO_SCHEMA_NAME = Object.freeze({
    // "GMProject: project" is deliberately omitted because @bscotch/yy's 'project' schema
    // drops unknown resources leading to data loss in valid project files.
    GMObject: "objects",
    GMScript: "scripts",
    GMRoom: "rooms",
    GMShader: "shaders",
    GMSound: "sounds",
    GMSprite: "sprites",
    GMExtension: "extensions",
    GMRoomUI: "roomui"
});

export type ProjectMetadataSchemaName = keyof typeof Yy.schemas;

const PROJECT_METADATA_SCHEMA_NAMES: ReadonlySet<ProjectMetadataSchemaName> = Object.freeze(
    new Set(Object.keys(Yy.schemas) as Array<ProjectMetadataSchemaName>)
);

function mapResourceTypeToSchemaName(resourceType: unknown): ProjectMetadataSchemaName | null {
    if (!Core.isNonEmptyTrimmedString(resourceType)) {
        return null;
    }

    const schemaName = RESOURCE_TYPE_TO_SCHEMA_NAME[resourceType];
    return schemaName ?? null;
}

function mapResourcePathToSchemaName(sourcePath: string): ProjectMetadataSchemaName | null {
    const normalizedPath = Core.toPosixPath(sourcePath);
    if (normalizedPath.toLowerCase().endsWith(".yyp")) {
        // Prevent inferring the "project" schema for GameMaker .yyp manifests.
        // The @bscotch/yy library's project schema validation silently filters out
        // unrecognized array entries, leading to data loss for valid projects.
        return null;
    }

    if (!normalizedPath.toLowerCase().endsWith(".yy")) {
        return null;
    }

    const segments = Core.trimStringEntries(normalizedPath.split("/"));
    if (segments.length < 2) {
        return null;
    }

    const directorySegments = segments.slice(0, -1);
    for (let index = directorySegments.length - 1; index >= 0; index -= 1) {
        const candidate = directorySegments[index]?.toLowerCase() as ProjectMetadataSchemaName | undefined;
        if (candidate && PROJECT_METADATA_SCHEMA_NAMES.has(candidate)) {
            return candidate;
        }
    }

    return null;
}

/**
 * Resolve the best available @bscotch/yy schema name for a metadata document.
 */
export function resolveProjectMetadataSchemaName(
    sourcePath: string,
    resourceType: unknown = null
): ProjectMetadataSchemaName | null {
    return mapResourceTypeToSchemaName(resourceType) ?? mapResourcePathToSchemaName(sourcePath);
}

/**
 * Error raised when a GameMaker metadata payload (.yy/.yyp) cannot be parsed.
 */
export class ProjectMetadataParseError extends Error {
    constructor(sourcePath: string, cause: unknown) {
        const details = Core.getErrorMessageOrFallback(cause);
        super(`Failed to parse GameMaker metadata from '${sourcePath}': ${details}`);
        this.name = PROJECT_METADATA_PARSE_ERROR;
        this.cause = Core.isErrorLike(cause) ? cause : undefined;
    }
}

/**
 * Error raised when metadata fails validation against an inferred yy schema.
 */
export class ProjectMetadataSchemaValidationError extends Error {
    constructor(sourcePath: string, schemaName: string, cause: unknown) {
        const details = Core.getErrorMessageOrFallback(cause);
        super(
            `Metadata at '${sourcePath}' does not match inferred '${schemaName}' schema required for safe mutation: ${details}`
        );
        this.name = PROJECT_METADATA_SCHEMA_VALIDATION_ERROR;
        this.cause = Core.isErrorLike(cause) ? cause : undefined;
    }
}

/**
 * Type guard for {@link ProjectMetadataParseError}.
 *
 * The name string is the primary contract: any object whose `.name` equals the
 * well-known constant passes this guard regardless of its prototype chain. This
 * makes the check resilient to cross-realm errors (e.g. errors thrown across
 * worker/sandbox boundaries) without relying on `instanceof` as the sole
 * discriminant. The `instanceof` fallback retains compatibility with direct
 * class instances when the name property has not been explicitly set.
 */
export function isProjectMetadataParseError(value: unknown): value is ProjectMetadataParseError {
    return (
        Core.getNonEmptyString((value as { name?: string })?.name) === PROJECT_METADATA_PARSE_ERROR ||
        value instanceof ProjectMetadataParseError
    );
}

/**
 * Type guard for {@link ProjectMetadataSchemaValidationError}.
 *
 * The name string is the primary contract: any object whose `.name` equals the
 * well-known constant passes this guard regardless of its prototype chain. This
 * makes the check resilient to cross-realm errors (e.g. errors thrown across
 * worker/sandbox boundaries) without relying on `instanceof` as the sole
 * discriminant. The `instanceof` fallback retains compatibility with direct
 * class instances when the name property has not been explicitly set.
 */
export function isProjectMetadataSchemaValidationError(value: unknown): value is ProjectMetadataSchemaValidationError {
    return (
        Core.getNonEmptyString((value as { name?: string })?.name) === PROJECT_METADATA_SCHEMA_VALIDATION_ERROR ||
        value instanceof ProjectMetadataSchemaValidationError
    );
}

function assertProjectMetadataDocumentIsPlainObject(parsed: unknown, sourcePath: string) {
    return Core.assertPlainObject(parsed, {
        errorMessage: `Resource JSON at ${sourcePath} must be a plain object.`
    });
}

function checkProjectMetadataDocumentSchema(
    rawContents: string,
    sourcePath: string,
    schemaName: ProjectMetadataSchemaName | null
): { schemaValidated: boolean; document: Record<string, unknown>; schemaError: unknown } {
    if (!schemaName) {
        return {
            schemaValidated: false,
            document: parseProjectMetadataDocument(rawContents, sourcePath),
            schemaError: null
        };
    }

    try {
        const schemaParsed = Yy.parse(rawContents, schemaName);
        return {
            schemaValidated: true,
            document: assertProjectMetadataDocumentIsPlainObject(schemaParsed, sourcePath),
            schemaError: null
        };
    } catch (error) {
        return {
            schemaValidated: false,
            document: parseProjectMetadataDocument(rawContents, sourcePath),
            schemaError: error
        };
    }
}

function readProjectMetadataDocumentFromFileWithoutSchema(sourcePath: string): Record<string, unknown> {
    let parsed: unknown;
    try {
        parsed = Yy.readSync(sourcePath);
    } catch (error) {
        throw new ProjectMetadataParseError(sourcePath, error);
    }

    return assertProjectMetadataDocumentIsPlainObject(parsed, sourcePath);
}

function checkProjectMetadataDocumentSchemaFromFile(
    sourcePath: string,
    schemaName: ProjectMetadataSchemaName | null
): { schemaValidated: boolean; document: Record<string, unknown>; schemaError: unknown } {
    if (!schemaName) {
        return {
            schemaValidated: false,
            document: readProjectMetadataDocumentFromFileWithoutSchema(sourcePath),
            schemaError: null
        };
    }

    try {
        const schemaParsed = Yy.readSync(sourcePath, schemaName);
        return {
            schemaValidated: true,
            document: assertProjectMetadataDocumentIsPlainObject(schemaParsed, sourcePath),
            schemaError: null
        };
    } catch (error) {
        return {
            schemaValidated: false,
            document: readProjectMetadataDocumentFromFileWithoutSchema(sourcePath),
            schemaError: error
        };
    }
}

/**
 * Parse a GameMaker metadata document using Stitch's yy parser.
 */
export function parseProjectMetadataDocument(rawContents: string, sourcePath: string) {
    let parsed: unknown;
    try {
        parsed = Yy.parse(rawContents);
    } catch (error) {
        throw new ProjectMetadataParseError(sourcePath, error);
    }

    return assertProjectMetadataDocumentIsPlainObject(parsed, sourcePath);
}

/**
 * Parse metadata, infer a schema name from resourceType/path, and report whether
 * the parsed payload matches the inferred schema.
 */
export function parseProjectMetadataDocumentWithSchema(rawContents: string, sourcePath: string) {
    const pathDerivedSchemaName = resolveProjectMetadataSchemaName(sourcePath);
    const pathDerivedSchemaResult = checkProjectMetadataDocumentSchema(rawContents, sourcePath, pathDerivedSchemaName);
    if (pathDerivedSchemaResult.schemaValidated) {
        return {
            document: pathDerivedSchemaResult.document,
            schemaName: pathDerivedSchemaName,
            schemaValidated: true,
            schemaError: null
        };
    }

    const fallbackDocument = pathDerivedSchemaResult.document;
    const schemaName = resolveProjectMetadataSchemaName(sourcePath, fallbackDocument.resourceType);
    if (!schemaName || schemaName === pathDerivedSchemaName) {
        return {
            document: fallbackDocument,
            schemaName,
            schemaValidated: false,
            schemaError: pathDerivedSchemaResult.schemaError
        };
    }

    const schemaResult = checkProjectMetadataDocumentSchema(rawContents, sourcePath, schemaName);

    return {
        document: schemaResult.document,
        schemaName,
        schemaValidated: schemaResult.schemaValidated,
        schemaError: schemaResult.schemaError
    };
}

/**
 * Parse metadata for mutation workflows, enforcing inferred schema validation
 * whenever a concrete schema can be derived from file path or resource type.
 */
export function parseProjectMetadataDocumentForMutation(rawContents: string, sourcePath: string) {
    const parsed = parseProjectMetadataDocumentWithSchema(rawContents, sourcePath);
    const requiresStrictValidation = parsed.schemaName && parsed.schemaName !== "project";
    if (requiresStrictValidation && !parsed.schemaValidated) {
        throw new ProjectMetadataSchemaValidationError(sourcePath, parsed.schemaName, parsed.schemaError);
    }

    return parsed;
}

/**
 * Stringify a metadata payload using Stitch's yy serializer.
 */
function ensureResourceTypeBeforeResourcePath(document: Record<string, unknown>): Record<string, unknown> {
    if (!Core.isObjectLike(document)) {
        return document;
    }

    const hasResourceType = Object.hasOwn(document, "resourceType");
    const hasResourcePath = Object.hasOwn(document, "resourcePath");

    if (!hasResourceType || !hasResourcePath) {
        return document;
    }

    const keys = Object.keys(document);
    const resourceTypeIndex = keys.indexOf("resourceType");
    const resourcePathIndex = keys.indexOf("resourcePath");

    if (resourceTypeIndex === -1 || resourcePathIndex === -1 || resourceTypeIndex < resourcePathIndex) {
        return document;
    }

    const ordered: Record<string, unknown> = {};
    for (const key of keys) {
        if (key === "resourcePath") {
            continue;
        }

        ordered[key] = document[key];

        if (key === "resourceType") {
            ordered.resourcePath = document.resourcePath;
        }
    }

    return ordered;
}

function ensureResourceTypeBeforeResourcePathInSerializedOutput(
    output: string,
    document: Record<string, unknown>
): string {
    if (!Core.isObjectLike(document) || !Core.isNonEmptyString(document.resourceType)) {
        return output;
    }

    const hasResourcePath = Object.hasOwn(document, "resourcePath");
    if (!hasResourcePath) {
        return output;
    }

    const eol = output.includes("\r\n") ? "\r\n" : "\n";
    const lines = output.split(/\r?\n/);

    let resourcePathLineIndex = -1;
    let resourceTypeLineIndex = -1;

    for (const [index, line] of lines.entries()) {
        const indent = line.search(/\S|$/);
        const trimmed = line.trimStart();

        if (indent !== 2) {
            continue; // only consider top-level property lines in serialized output
        }

        if (trimmed.startsWith('"resourcePath"')) {
            resourcePathLineIndex = index;
        }

        if (trimmed.startsWith('"resourceType"')) {
            resourceTypeLineIndex = index;
        }

        if (resourcePathLineIndex !== -1 && resourceTypeLineIndex !== -1) {
            break;
        }
    }

    if (resourcePathLineIndex === -1 || resourceTypeLineIndex === -1) {
        return output;
    }

    if (resourceTypeLineIndex < resourcePathLineIndex) {
        return output;
    }

    const copy = [...lines];
    [copy[resourcePathLineIndex], copy[resourceTypeLineIndex]] = [
        copy[resourceTypeLineIndex],
        copy[resourcePathLineIndex]
    ];

    return copy.join(eol);
}

function normalizeMetadataValueForSerialization(value: unknown): unknown {
    const objectTag = Object.prototype.toString.call(value);
    if (objectTag === "[object Number]" || objectTag === "[object String]" || objectTag === "[object Boolean]") {
        return value.valueOf();
    }

    if (Array.isArray(value)) {
        return value.map((entry) => normalizeMetadataValueForSerialization(entry));
    }

    if (!Core.isObjectLike(value)) {
        return value;
    }

    const normalizedObject: Record<string, unknown> = {};
    for (const [key, childValue] of Object.entries(value)) {
        normalizedObject[key] = normalizeMetadataValueForSerialization(childValue);
    }

    return normalizedObject;
}

export function stringifyProjectMetadataDocument(document: Record<string, unknown>, sourcePath = "") {
    const normalizedDocument = ensureResourceTypeBeforeResourcePath(
        normalizeMetadataValueForSerialization(document) as Record<string, unknown>
    );
    let schemaName = Core.isNonEmptyString(sourcePath)
        ? resolveProjectMetadataSchemaName(sourcePath, normalizedDocument.resourceType)
        : null;

    // Avoid using @bscotch/yy's `project` schema when serializing project manifests
    // as the schema validation strips out valid resources not covered by the schema.
    if (schemaName === "project") {
        schemaName = null;
    }

    const rawOutput = ((): string => {
        if (schemaName) {
            try {
                return Yy.stringify(normalizedDocument, schemaName);
            } catch (error) {
                throw new ProjectMetadataSchemaValidationError(sourcePath, schemaName, error);
            }
        }

        return Yy.stringify(normalizedDocument);
    })();

    return ensureResourceTypeBeforeResourcePathInSerializedOutput(rawOutput, normalizedDocument);
}

/**
 * Read and parse a GameMaker metadata file from disk.
 *
 * When a schema can be inferred from path/resourceType, this uses
 * schema-aware `Yy.readSync` parsing first and reports schema validation
 * status in the same shape as {@link parseProjectMetadataDocumentWithSchema}.
 */
export function readProjectMetadataDocumentFromFile(sourcePath: string) {
    const pathDerivedSchemaName = resolveProjectMetadataSchemaName(sourcePath);
    const pathDerivedSchemaResult = checkProjectMetadataDocumentSchemaFromFile(sourcePath, pathDerivedSchemaName);
    if (pathDerivedSchemaResult.schemaValidated) {
        return {
            document: pathDerivedSchemaResult.document,
            schemaName: pathDerivedSchemaName,
            schemaValidated: true,
            schemaError: null
        };
    }

    const fallbackDocument = pathDerivedSchemaResult.document;
    const schemaName = resolveProjectMetadataSchemaName(sourcePath, fallbackDocument.resourceType);
    if (!schemaName || schemaName === pathDerivedSchemaName) {
        return {
            document: fallbackDocument,
            schemaName,
            schemaValidated: false,
            schemaError: pathDerivedSchemaResult.schemaError
        };
    }

    const schemaResult = checkProjectMetadataDocumentSchemaFromFile(sourcePath, schemaName);
    return {
        document: schemaResult.document,
        schemaName,
        schemaValidated: schemaResult.schemaValidated,
        schemaError: schemaResult.schemaError
    };
}

/**
 * Read metadata from disk for mutation workflows, enforcing schema validity
 * through the same strict policy as {@link parseProjectMetadataDocumentForMutation}.
 */
export function readProjectMetadataDocumentForMutationFromFile(sourcePath: string) {
    const parsed = readProjectMetadataDocumentFromFile(sourcePath);
    const requiresStrictValidation = parsed.schemaName && parsed.schemaName !== "project";
    if (requiresStrictValidation && !parsed.schemaValidated) {
        throw new ProjectMetadataSchemaValidationError(sourcePath, parsed.schemaName, parsed.schemaError);
    }

    return parsed;
}

/**
 * Write a metadata document to disk using `@bscotch/yy` as the primary writer.
 *
 * Returns `true` when bytes were written and `false` when `Yy.writeSync`
 * short-circuits because no file content changed.
 */
export function writeProjectMetadataDocumentToFile(sourcePath: string, document: Record<string, unknown>): boolean {
    const normalizedDocument = ensureResourceTypeBeforeResourcePath(document);
    const contents = stringifyProjectMetadataDocument(normalizedDocument, sourcePath);

    try {
        if (fs.existsSync(sourcePath)) {
            const existing = fs.readFileSync(sourcePath, "utf8");
            if (existing === contents) {
                return false;
            }
        }

        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, contents, "utf8");
        return true;
    } catch (error) {
        // Fallback to @bscotch/yy write path if manual file write fails
        const schemaName = resolveProjectMetadataSchemaName(sourcePath, normalizedDocument.resourceType);
        try {
            return Yy.writeSync(sourcePath, normalizedDocument, schemaName ?? undefined);
        } catch {
            throw error;
        }
    }
}

function resolveProjectMetadataPathTarget(
    document: Record<string, unknown>,
    propertyPath: string
): {
    container: Record<string, unknown> | Array<unknown>;
    key: string | number;
    value: unknown;
} | null {
    const segments = Core.trimStringEntries(propertyPath.split(".")).filter((segment) => segment.length > 0);
    if (segments.length === 0) {
        return null;
    }

    let current: unknown = document;
    for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const isLast = index === segments.length - 1;

        if (Array.isArray(current)) {
            const arrayIndex = Number(segment);
            if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex >= current.length) {
                return null;
            }

            if (isLast) {
                return {
                    container: current,
                    key: arrayIndex,
                    value: current[arrayIndex]
                };
            }

            current = current[arrayIndex];
            continue;
        }

        if (!Core.isObjectLike(current)) {
            return null;
        }

        const objectRecord = current as Record<string, unknown>;
        if (!Object.hasOwn(objectRecord, segment)) {
            return null;
        }

        if (isLast) {
            return {
                container: objectRecord,
                key: segment,
                value: objectRecord[segment]
            };
        }

        current = objectRecord[segment];
    }

    return null;
}

type ProjectMetadataValueTextRange = {
    end: number;
    start: number;
};

function skipProjectMetadataWhitespace(rawContents: string, startIndex: number): number {
    let index = startIndex;
    while (index < rawContents.length && /\s/u.test(rawContents[index] ?? "")) {
        index += 1;
    }

    return index;
}

function parseProjectMetadataStringLiteral(
    rawContents: string,
    startIndex: number
): { end: number; value: string } | null {
    if (rawContents[startIndex] !== '"') {
        return null;
    }

    let index = startIndex + 1;
    let value = "";

    while (index < rawContents.length) {
        const character = rawContents[index];
        if (character === '"') {
            return {
                end: index + 1,
                value
            };
        }

        if (character === "\\") {
            const escapedCharacter = rawContents[index + 1];
            if (escapedCharacter === undefined) {
                return null;
            }

            if (
                escapedCharacter === '"' ||
                escapedCharacter === "\\" ||
                escapedCharacter === "/" ||
                escapedCharacter === "b" ||
                escapedCharacter === "f" ||
                escapedCharacter === "n" ||
                escapedCharacter === "r" ||
                escapedCharacter === "t"
            ) {
                value += JSON.parse(`"${character}${escapedCharacter}"`) as string;
                index += 2;
                continue;
            }

            if (escapedCharacter === "u") {
                const unicodeEscape = rawContents.slice(index + 2, index + 6);
                if (!/^[\da-fA-F]{4}$/u.test(unicodeEscape)) {
                    return null;
                }

                value += String.fromCodePoint(Number.parseInt(unicodeEscape, 16));
                index += 6;
                continue;
            }

            return null;
        }

        value += character;
        index += 1;
    }

    return null;
}

function skipProjectMetadataNumberLiteral(rawContents: string, startIndex: number): number | null {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(rawContents.slice(startIndex));
    if (!match) {
        return null;
    }

    return startIndex + match[0].length;
}

function skipProjectMetadataValue(rawContents: string, startIndex: number): number | null {
    const index = skipProjectMetadataWhitespace(rawContents, startIndex);
    const character = rawContents[index];

    if (character === '"') {
        return parseProjectMetadataStringLiteral(rawContents, index)?.end ?? null;
    }

    if (character === "{") {
        let cursor = index + 1;
        while (true) {
            cursor = skipProjectMetadataWhitespace(rawContents, cursor);
            if (rawContents[cursor] === "}") {
                return cursor + 1;
            }

            const key = parseProjectMetadataStringLiteral(rawContents, cursor);
            if (key === null) {
                return null;
            }

            cursor = skipProjectMetadataWhitespace(rawContents, key.end);
            if (rawContents[cursor] !== ":") {
                return null;
            }

            const valueEnd = skipProjectMetadataValue(rawContents, cursor + 1);
            if (valueEnd === null) {
                return null;
            }

            cursor = skipProjectMetadataWhitespace(rawContents, valueEnd);
            if (rawContents[cursor] === ",") {
                cursor += 1;
                continue;
            }

            if (rawContents[cursor] === "}") {
                return cursor + 1;
            }

            return null;
        }
    }

    if (character === "[") {
        let cursor = index + 1;
        while (true) {
            cursor = skipProjectMetadataWhitespace(rawContents, cursor);
            if (rawContents[cursor] === "]") {
                return cursor + 1;
            }

            const valueEnd = skipProjectMetadataValue(rawContents, cursor);
            if (valueEnd === null) {
                return null;
            }

            cursor = skipProjectMetadataWhitespace(rawContents, valueEnd);
            if (rawContents[cursor] === ",") {
                cursor += 1;
                continue;
            }

            if (rawContents[cursor] === "]") {
                return cursor + 1;
            }

            return null;
        }
    }

    for (const literal of ["true", "false", "null"] as const) {
        if (rawContents.startsWith(literal, index)) {
            return index + literal.length;
        }
    }

    return skipProjectMetadataNumberLiteral(rawContents, index);
}

function resolveProjectMetadataValueTextRangeInObject(
    rawContents: string,
    startIndex: number,
    propertySegments: ReadonlyArray<string>
): ProjectMetadataValueTextRange | null {
    if (propertySegments.length === 0) {
        return {
            start: startIndex,
            end: skipProjectMetadataValue(rawContents, startIndex) ?? startIndex
        };
    }

    const [segment, ...remainingSegments] = propertySegments;
    if (!Core.isNonEmptyString(segment) || /^\d+$/u.test(segment)) {
        return null;
    }

    let cursor = startIndex + 1;

    while (true) {
        cursor = skipProjectMetadataWhitespace(rawContents, cursor);
        if (rawContents[cursor] === "}") {
            return null;
        }

        const key = parseProjectMetadataStringLiteral(rawContents, cursor);
        if (key === null) {
            return null;
        }

        cursor = skipProjectMetadataWhitespace(rawContents, key.end);
        if (rawContents[cursor] !== ":") {
            return null;
        }

        const valueStart = skipProjectMetadataWhitespace(rawContents, cursor + 1);

        if (key.value === segment) {
            if (remainingSegments.length === 0) {
                const valueEnd = skipProjectMetadataValue(rawContents, valueStart);
                return valueEnd === null
                    ? null
                    : {
                          start: valueStart,
                          end: valueEnd
                      };
            }

            return resolveProjectMetadataValueTextRange(rawContents, valueStart, remainingSegments);
        }

        const valueEnd = skipProjectMetadataValue(rawContents, valueStart);
        if (valueEnd === null) {
            return null;
        }

        cursor = skipProjectMetadataWhitespace(rawContents, valueEnd);
        if (rawContents[cursor] === ",") {
            cursor += 1;
            continue;
        }

        if (rawContents[cursor] === "}") {
            return null;
        }

        return null;
    }
}

function resolveProjectMetadataValueTextRangeInArray(
    rawContents: string,
    startIndex: number,
    propertySegments: ReadonlyArray<string>
): ProjectMetadataValueTextRange | null {
    if (propertySegments.length === 0) {
        return {
            start: startIndex,
            end: skipProjectMetadataValue(rawContents, startIndex) ?? startIndex
        };
    }

    const [segment, ...remainingSegments] = propertySegments;
    if (!/^\d+$/u.test(segment ?? "")) {
        return null;
    }

    const targetIndex = Number(segment);
    let cursor = startIndex + 1;
    let currentIndex = 0;

    while (true) {
        cursor = skipProjectMetadataWhitespace(rawContents, cursor);
        if (rawContents[cursor] === "]") {
            return null;
        }

        const valueStart = cursor;
        const valueEnd = skipProjectMetadataValue(rawContents, valueStart);
        if (valueEnd === null) {
            return null;
        }

        if (currentIndex === targetIndex) {
            if (remainingSegments.length === 0) {
                return {
                    start: valueStart,
                    end: valueEnd
                };
            }

            return resolveProjectMetadataValueTextRange(rawContents, valueStart, remainingSegments);
        }

        currentIndex += 1;
        cursor = skipProjectMetadataWhitespace(rawContents, valueEnd);
        if (rawContents[cursor] === ",") {
            cursor += 1;
            continue;
        }

        if (rawContents[cursor] === "]") {
            return null;
        }

        return null;
    }
}

function resolveProjectMetadataValueTextRange(
    rawContents: string,
    startIndex: number,
    propertySegments: ReadonlyArray<string>
): ProjectMetadataValueTextRange | null {
    const index = skipProjectMetadataWhitespace(rawContents, startIndex);
    const character = rawContents[index];

    if (propertySegments.length === 0) {
        const end = skipProjectMetadataValue(rawContents, index);
        return end === null
            ? null
            : {
                  start: index,
                  end
              };
    }

    if (character === "{") {
        return resolveProjectMetadataValueTextRangeInObject(rawContents, index, propertySegments);
    }

    if (character === "[") {
        return resolveProjectMetadataValueTextRangeInArray(rawContents, index, propertySegments);
    }

    return null;
}

/**
 * Locate the byte range for a value identified by a metadata property path.
 *
 * The parser is intentionally minimal and preserves GameMaker's permissive
 * trailing-comma syntax so refactor flows can patch specific string literals
 * without reserializing the entire `.yy/.yyp` document.
 *
 * @param rawContents - Original metadata text.
 * @param propertyPath - Dot-delimited property path such as `resources.0.id.path`.
 * @returns The inclusive start / exclusive end byte range for the target value.
 */
export function findProjectMetadataValueTextRange(
    rawContents: string,
    propertyPath: string
): ProjectMetadataValueTextRange | null {
    if (!Core.isNonEmptyString(rawContents) || !Core.isNonEmptyString(propertyPath)) {
        return null;
    }

    const propertySegments = Core.trimStringEntries(propertyPath.split(".")).filter((segment) => segment.length > 0);
    if (propertySegments.length === 0) {
        return null;
    }

    return resolveProjectMetadataValueTextRange(rawContents, 0, propertySegments);
}

/**
 * Apply targeted string-literal mutations to a metadata document while
 * preserving every untouched byte of the original text.
 *
 * Returns `null` when any requested property path cannot be located as a
 * string literal in the current document, allowing callers to fall back to a
 * full structured rewrite when needed.
 *
 * @param rawContents - Original metadata text.
 * @param stringMutations - Property-path updates to apply.
 * @returns Rewritten metadata text, or `null` when patching fails.
 */
export function applyProjectMetadataStringMutations(
    rawContents: string,
    stringMutations: ReadonlyArray<{ propertyPath: string; value: string }>
): string | null {
    if (!Array.isArray(stringMutations) || stringMutations.length === 0) {
        return rawContents;
    }

    let nextContents = rawContents;

    for (const mutation of stringMutations) {
        if (!Core.isNonEmptyString(mutation?.propertyPath) || typeof mutation?.value !== "string") {
            return null;
        }

        const textRange = findProjectMetadataValueTextRange(nextContents, mutation.propertyPath);
        if (textRange === null) {
            return null;
        }

        const existingValueLiteral = nextContents.slice(textRange.start, textRange.end);
        if (!existingValueLiteral.startsWith('"') || !existingValueLiteral.endsWith('"')) {
            return null;
        }

        nextContents = `${nextContents.slice(0, textRange.start)}${JSON.stringify(mutation.value)}${nextContents.slice(textRange.end)}`;
    }

    return nextContents;
}

/**
 * Resolve a nested value from parsed metadata by property path.
 */
export function getProjectMetadataValueAtPath(document: Record<string, unknown>, propertyPath: string): unknown {
    if (!Core.isNonEmptyString(propertyPath)) {
        return document;
    }

    const target = resolveProjectMetadataPathTarget(document, propertyPath);
    return target ? target.value : null;
}

/**
 * Update a metadata reference at a property path.
 *
 * Supports both object references (`{ name, path }`) and direct string path fields.
 */
export function updateProjectMetadataReferenceByPath({
    document,
    propertyPath,
    newResourcePath,
    newName
}: {
    document: Record<string, unknown>;
    propertyPath: string;
    newResourcePath: string | null;
    newName: string | null;
}): boolean {
    if (!Core.isNonEmptyString(propertyPath) || !Core.isObjectLike(document)) {
        return false;
    }

    const target = resolveProjectMetadataPathTarget(document, propertyPath);
    if (!target) {
        return false;
    }

    if (Core.isObjectLike(target.value)) {
        const targetRecord = target.value as Record<string, unknown>;
        let changed = false;

        if (Core.isNonEmptyString(newResourcePath) && targetRecord.path !== newResourcePath) {
            targetRecord.path = newResourcePath;
            changed = true;
        }

        if (Core.isNonEmptyString(newName) && targetRecord.name !== newName) {
            targetRecord.name = newName;
            changed = true;
        }

        return changed;
    }

    if (
        typeof target.value === "string" &&
        Core.isNonEmptyString(newResourcePath) &&
        target.value !== newResourcePath
    ) {
        if (Array.isArray(target.container)) {
            target.container[target.key as number] = newResourcePath;
        } else {
            target.container[target.key as string] = newResourcePath;
        }
        return true;
    }

    return false;
}
