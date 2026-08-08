import { readTextFileSync } from "../fs/io.js";
import { noop } from "../utils/function.js";
import { isObjectLike, isPlainObject } from "../utils/object.js";
import { getNonEmptyString } from "../utils/string.js";
import { resolveBundledResourcePath, resolveBundledResourceUrl } from "./resource-locator.js";

// The metadata URL/path constants are exposed as lazy accessors rather
// than top-level `const` bindings. Resolving them at module load would
// touch Node-only APIs (`node:url`, `node:path`, `node:fs`) that are
// externalized to empty stubs in the browser bundle, which would crash
// any non-Node consumer that imports `@gmloop/core` for its AST/utility
// surface. Deferring the resolution to first access keeps module load
// safe in browser contexts while preserving eager access for Node-side
// callers (which invoke the accessor at module load, the same instant
// the previous `const` would have evaluated).

let cachedGmlIdentifierMetadataUrl: URL | null = null;
let cachedGmlIdentifierMetadataPath: string | null = null;

export function getGmlIdentifierMetadataUrl(): URL {
    if (cachedGmlIdentifierMetadataUrl === null) {
        cachedGmlIdentifierMetadataUrl = resolveBundledResourceUrl("gml-identifiers.json");
    }
    return cachedGmlIdentifierMetadataUrl;
}

export function getGmlIdentifierMetadataPath(): string {
    if (cachedGmlIdentifierMetadataPath === null) {
        cachedGmlIdentifierMetadataPath = resolveBundledResourcePath("gml-identifiers.json");
    }
    return cachedGmlIdentifierMetadataPath;
}

/**
 * Replacement semantics for a deprecated built-in GML identifier.
 */
export type DeprecatedIdentifierReplacementKind = "direct-rename" | "manual-migration" | "none";

/**
 * Source-code shape that a deprecated built-in identifier can appear in.
 */
export type DeprecatedIdentifierLegacyUsage = "call" | "identifier" | "indexed-identifier" | "call-or-identifier";

/**
 * Canonical lint owner for deprecated identifiers that overlap with Feather
 * parity diagnostics.
 */
export type DeprecatedIdentifierDiagnosticOwner = "gml" | "feather";

/**
 * Normalized deprecated identifier metadata derived from the bundled manual
 * artifact.
 */
export type DeprecatedIdentifierMetadataEntry = Readonly<{
    name: string;
    type: string;
    replacement: string | null;
    replacementKind: DeprecatedIdentifierReplacementKind;
    legacyCategory: string | null;
    legacyUsage: DeprecatedIdentifierLegacyUsage;
    diagnosticOwner: DeprecatedIdentifierDiagnosticOwner | null;
    descriptor: Readonly<Record<string, unknown>>;
}>;

/**
 * Normalized parameter payload for a built-in identifier's hover entry.
 *
 * The contract intentionally exposes `null` rather than `undefined` for any
 * optional field so consumers can treat the value uniformly without
 * discriminating between "missing" and "present-but-empty". Adapter code in
 * {@link normalizeBuiltInHoverParameter} guarantees the shape regardless of
 * the underlying JSON layout.
 */
export type BuiltInHoverParameter = Readonly<{
    name: string;
    type: string | null;
    description: string | null;
}>;

/**
 * Normalized hover payload for a built-in identifier.
 *
 * The contract mirrors the surface that downstream consumers (LSP hover,
 * completion detail, semantic highlight hover) actually consume, so any
 * structural variation in the bundled metadata JSON — missing fields,
 * reordered keys, or alternate casing — is absorbed by the
 * {@link normalizeBuiltInHoverInfo} adapter rather than leaked into call
 * sites.
 */
export type BuiltInHoverInfo = Readonly<{
    signature: string | null;
    description: string | null;
    parameters: ReadonlyArray<BuiltInHoverParameter>;
    returnType: string | null;
}>;

/**
 * Load the bundled identifier metadata JSON artefact.
 *
 * Centralizing path resolution keeps consumers from depending on the
 * repository layout and enables callers to treat the metadata as an injected
 * dependency rather than reaching into package internals.
 *
 * @returns {unknown} Raw identifier metadata payload bundled with the package.
 */
export function loadBundledIdentifierMetadata() {
    const contents = readTextFileSync(getGmlIdentifierMetadataPath());
    return JSON.parse(contents);
}

let cachedIdentifierMetadata: unknown = null;
let cachedDeprecatedIdentifierEntries: ReadonlyArray<DeprecatedIdentifierMetadataEntry> | null = null;

/**
 * Cached Set of manual function names to avoid re-allocating on every call.
 * Reset alongside metadata cache to maintain consistency.
 */
let cachedManualFunctionNames: Set<string> | null = null;

/**
 * Cached normalized hover payloads keyed by identifier name. The cache stores
 * both resolved and null results so repeat lookups for the same identifier
 * skip the per-call adapter walk without re-running type guards.
 *
 * Reset alongside clearIdentifierMetadataCache so test harnesses can
 * force a fresh normalization pass.
 */
const cachedBuiltInHoverInfo = new Map<string, BuiltInHoverInfo | null>();

/**
 * Maximum number of cached reserved identifier name Sets.
 * Limits memory growth when many different disallowedTypes configurations are used.
 * Common configurations (e.g., default, no exclusions) will remain cached while
 * rarely-used combinations are evicted using LRU strategy.
 */
const RESERVED_IDENTIFIER_CACHE_MAX_SIZE = 10;

/**
 * LRU cache of reserved identifier names keyed by excluded types.
 * Maintains separate caches for different exclusion configurations, with
 * automatic eviction of least-recently-used entries when the limit is reached.
 *
 * Using Map guarantees insertion order, which we leverage for LRU eviction:
 * - Recently accessed keys are moved to the end via delete + re-insert
 * - Oldest (least recently used) keys are at the beginning
 */
const cachedReservedIdentifierNames = new Map<string, Set<string>>();

/**
 * Retrieve the cached identifier metadata payload.
 *
 * @returns {unknown} Cached identifier metadata payload.
 */
export function getIdentifierMetadata() {
    return loadIdentifierMetadata();
}

/**
 * Reset the metadata cache so test harnesses can force a reload.
 * Also clears derived caches (function names, reserved identifiers, hover
 * info).
 */
export function clearIdentifierMetadataCache() {
    cachedIdentifierMetadata = null;
    cachedDeprecatedIdentifierEntries = null;
    cachedManualFunctionNames = null;
    cachedReservedIdentifierNames.clear();
    cachedBuiltInHoverInfo.clear();
}

/**
 * Normalize the identifier metadata entries by extracting and validating
 * each entry from the raw payload.
 * @param {*} metadata
 * @returns {Array<{ name: string, type: string, descriptor: object }>}
 */
export function normalizeIdentifierMetadataEntries(metadata) {
    const identifiers =
        metadata && typeof metadata === "object" && "identifiers" in metadata
            ? (metadata as { identifiers?: unknown }).identifiers
            : null;

    if (!isPlainObject(identifiers)) {
        return [];
    }

    return Object.entries(identifiers).reduce((entries, [name, descriptor]) => {
        const normalizedName = getNonEmptyString(name);
        if (!normalizedName) {
            return entries;
        }

        const normalizedDescriptor = normalizeIdentifierDescriptor(descriptor);
        if (!normalizedDescriptor) {
            return entries;
        }

        entries.push({
            name: normalizedName,
            type: normalizedDescriptor.type.toLowerCase(),
            descriptor: normalizedDescriptor
        });

        return entries;
    }, []);
}

/**
 * Load normalized deprecated identifier entries from the bundled metadata.
 *
 * The result is cached and intentionally preserves the original descriptor so
 * lint consumers can inspect additional metadata fields without reparsing the
 * JSON payload.
 *
 * @returns Readonly array of deprecated identifier metadata entries.
 */
export function loadDeprecatedIdentifierEntries(): ReadonlyArray<DeprecatedIdentifierMetadataEntry> {
    if (cachedDeprecatedIdentifierEntries !== null) {
        return cachedDeprecatedIdentifierEntries;
    }

    const metadata = loadIdentifierMetadata();
    const entries = normalizeIdentifierMetadataEntries(metadata);
    const deprecatedEntries: Array<DeprecatedIdentifierMetadataEntry> = [];

    for (const entry of entries) {
        const descriptorRecord = entry.descriptor as Readonly<Record<string, unknown>>;
        if (descriptorRecord.deprecated !== true) {
            continue;
        }

        const replacement = getStringField(descriptorRecord, "replacement");
        deprecatedEntries.push(
            Object.freeze({
                name: entry.name,
                type: entry.type,
                replacement,
                replacementKind: normalizeDeprecatedReplacementKind(descriptorRecord, replacement),
                legacyCategory: getStringField(descriptorRecord, "legacyCategory"),
                legacyUsage: normalizeDeprecatedLegacyUsage(descriptorRecord, entry.type),
                diagnosticOwner: normalizeDeprecatedDiagnosticOwner(descriptorRecord),
                descriptor: descriptorRecord
            })
        );
    }

    cachedDeprecatedIdentifierEntries = Object.freeze(deprecatedEntries);
    return cachedDeprecatedIdentifierEntries;
}

type IdentifierMetadataDescriptor = {
    type: string;
    [key: string]: unknown;
};

function getStringField(record: Readonly<Record<string, unknown>>, key: string): string | null {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeDeprecatedReplacementKind(
    record: Readonly<Record<string, unknown>>,
    replacement: string | null
): DeprecatedIdentifierReplacementKind {
    const replacementKind = record.replacementKind;
    if (replacementKind === "direct-rename" || replacementKind === "manual-migration" || replacementKind === "none") {
        return replacementKind;
    }

    return replacement ? "direct-rename" : "none";
}

function normalizeDeprecatedLegacyUsage(
    record: Readonly<Record<string, unknown>>,
    normalizedType: string
): DeprecatedIdentifierLegacyUsage {
    const legacyUsage = record.legacyUsage;
    if (
        legacyUsage === "call" ||
        legacyUsage === "identifier" ||
        legacyUsage === "indexed-identifier" ||
        legacyUsage === "call-or-identifier"
    ) {
        return legacyUsage;
    }

    return normalizedType === "function" ? "call" : "identifier";
}

function normalizeDeprecatedDiagnosticOwner(
    record: Readonly<Record<string, unknown>>
): DeprecatedIdentifierDiagnosticOwner | null {
    const diagnosticOwner = record.diagnosticOwner;
    return diagnosticOwner === "gml" || diagnosticOwner === "feather" ? diagnosticOwner : null;
}

function normalizeIdentifierDescriptor(descriptor: unknown): IdentifierMetadataDescriptor | null {
    if (!isPlainObject(descriptor)) {
        return null;
    }

    const descriptorRecord = descriptor as Record<string, unknown>;
    const normalizedType = getNonEmptyString(descriptorRecord.type);
    if (!normalizedType) {
        return null;
    }

    if (descriptorRecord.type === normalizedType) {
        return descriptorRecord as IdentifierMetadataDescriptor;
    }

    return { ...descriptorRecord, type: normalizedType };
}

const DEFAULT_EXCLUDED_TYPES = new Set(["literal", "keyword"]);

let metadataLoader: () => unknown = loadBundledIdentifierMetadata;

function loadIdentifierMetadata() {
    if (cachedIdentifierMetadata === null) {
        try {
            const metadata = metadataLoader();
            cachedIdentifierMetadata = isObjectLike(metadata) ? metadata : null;
        } catch {
            cachedIdentifierMetadata = null;
        }
    }

    return cachedIdentifierMetadata;
}

/**
 * Allow advanced integrations to supply alternate metadata at runtime while
 * keeping the default loader pointed at the bundled JSON file.
 *
 * @param loader Custom metadata loader function, or a falsy value to reset
 *        to the default bundled JSON loader.
 * @returns {() => void} Cleanup handler that restores the previous loader when
 *          invoked. The handler intentionally degrades to a no-op when another
 *          caller swapped the loader before cleanup runs. Identifier casing
 *          integrations layer overrides during try/finally flows; blindly
 *          reinstating `previousLoader` would roll back those newer overrides
 *          and leave the formatter reading stale metadata mid-run.
 */
export function setReservedIdentifierMetadataLoader(loader: (() => unknown) | null | undefined) {
    if (typeof loader !== "function") {
        resetReservedIdentifierMetadataLoader();
        return noop;
    }

    const previousLoader = metadataLoader;
    metadataLoader = loader;

    // Clear caches when the loader changes to prevent stale data
    clearIdentifierMetadataCache();

    return () => {
        if (metadataLoader === loader) {
            metadataLoader = previousLoader;
            // Clear caches when restoring to prevent using cached data from the custom loader
            clearIdentifierMetadataCache();
        }
    };
}

/**
 * Restore the reserved identifier metadata loader back to the bundled JSON
 * implementation.
 */
export function resetReservedIdentifierMetadataLoader() {
    metadataLoader = loadBundledIdentifierMetadata;
    // Clear caches when resetting to ensure fresh data from default loader
    clearIdentifierMetadataCache();
}

function resolveExcludedTypes(types: unknown): Set<string> {
    if (!Array.isArray(types)) {
        return new Set(DEFAULT_EXCLUDED_TYPES);
    }

    const normalized = new Set<string>();
    for (const type of types) {
        const candidate = getNonEmptyString(type);
        if (candidate) {
            normalized.add(candidate.toLowerCase());
        }
    }

    return normalized;
}

/**
 * Generate a stable cache key from excluded types Set.
 * Uses a sorted, joined string representation for consistent lookups.
 */
function createExcludedTypesCacheKey(excludedTypes: Set<string>): string {
    if (excludedTypes.size === 0) {
        return "";
    }

    // Sort only once when creating the cache key
    return Array.from(excludedTypes).toSorted().join(",");
}

/**
 * Evict the least recently used entry from the reserved identifier cache
 * if the cache has reached its maximum size.
 *
 * Map maintains insertion order, so the first key is the oldest/LRU entry.
 */
function evictLruIfNeeded(): void {
    if (cachedReservedIdentifierNames.size >= RESERVED_IDENTIFIER_CACHE_MAX_SIZE) {
        // Get the first (oldest) key and delete it
        const oldestKey = cachedReservedIdentifierNames.keys().next().value;
        if (oldestKey !== undefined) {
            cachedReservedIdentifierNames.delete(oldestKey);
        }
    }
}

export function loadReservedIdentifierNames({ disallowedTypes }: { disallowedTypes?: string[] } = {}) {
    const excludedTypes = resolveExcludedTypes(disallowedTypes);
    const cacheKey = createExcludedTypesCacheKey(excludedTypes);

    // Check if already cached
    const cached = cachedReservedIdentifierNames.get(cacheKey);
    if (cached) {
        // Move to end (most recently used) by re-inserting
        cachedReservedIdentifierNames.delete(cacheKey);
        cachedReservedIdentifierNames.set(cacheKey, cached);
        return cached;
    }

    // Cache miss - compute the Set
    const metadata = loadIdentifierMetadata();
    const entries = normalizeIdentifierMetadataEntries(metadata);

    if (entries.length === 0) {
        const emptySet = new Set<string>();
        // Evict LRU entry if at capacity before inserting
        evictLruIfNeeded();
        cachedReservedIdentifierNames.set(cacheKey, emptySet);
        return emptySet;
    }

    const names = new Set<string>();

    for (const { name, type } of entries) {
        const normalizedType = getNonEmptyString(type);
        if (normalizedType && excludedTypes.has(normalizedType.toLowerCase())) {
            continue;
        }

        const normalizedName = getNonEmptyString(name);
        if (normalizedName) {
            names.add(normalizedName);
        }
    }

    // Evict LRU entry if at capacity before inserting
    evictLruIfNeeded();
    cachedReservedIdentifierNames.set(cacheKey, names);
    return names;
}

/**
 * Load manual function identifiers from the bundled metadata payload.
 *
 * The result is cached to avoid re-allocating the Set on every call.
 * Multiple calls return the same Set instance, reducing memory churn.
 *
 * @returns {Set<string>} A cached set of function names declared in the manual data.
 */
export function loadManualFunctionNames(): Set<string> {
    // Return cached Set if available
    if (cachedManualFunctionNames !== null) {
        return cachedManualFunctionNames;
    }

    // Cache miss - compute the Set
    const metadata = loadIdentifierMetadata();
    const entries = normalizeIdentifierMetadataEntries(metadata);

    if (entries.length === 0) {
        cachedManualFunctionNames = new Set<string>();
        return cachedManualFunctionNames;
    }

    const names = new Set<string>();

    for (const { name, type } of entries) {
        if (type !== "function" && type !== "unknown") {
            continue;
        }

        const normalizedName = getNonEmptyString(name);
        if (normalizedName) {
            names.add(normalizedName);
        }
    }

    // Store in cache and return
    cachedManualFunctionNames = names;
    return cachedManualFunctionNames;
}


/**
 * Normalize a single hover-parameter entry into the BuiltInHoverParameter
 * contract.
 *
 * Used exclusively by normalizeBuiltInHoverInfo to absorb arbitrary shape
 * variation from the bundled metadata JSON. The function returns null
 * whenever the entry is missing the required name field so the surrounding
 * array can prune malformed entries without callers having to discriminate.
 *
 * @param value Unknown candidate value (typically a JSON object).
 * @returns Normalized parameter or null when the entry is unusable.
 */
function normalizeBuiltInHoverParameter(value: unknown): BuiltInHoverParameter | null {
    if (!isPlainObject(value)) {
        return null;
    }

    const record = value as Readonly<Record<string, unknown>>;
    const name = getNonEmptyString(record.name);
    if (name === null) {
        return null;
    }

    return Object.freeze({
        name,
        type: getStringField(record, "type"),
        description: getStringField(record, "description")
    });
}

/**
 * Normalize a hover payload from any shape into the BuiltInHoverInfo
 * contract.
 *
 * This adapter owns every duck-typing step against the bundled metadata JSON,
 * so downstream consumers (LSP hover, completion detail, semantic highlight
 * hover) read from a uniform contract surface. Values that are missing,
 * malformed, or come from a substitute loader all funnel through the same
 * normalization path and yield either a populated contract or null.
 *
 * @param value Unknown candidate value (typically the hover field of a
 *              built-in descriptor).
 * @returns Normalized hover info or null when the input lacks a usable
 *          shape.
 */
function normalizeBuiltInHoverInfo(value: unknown): BuiltInHoverInfo | null {
    if (!isPlainObject(value)) {
        return null;
    }

    const record = value as Readonly<Record<string, unknown>>;
    const parameters = Array.isArray(record.parameters)
        ? (record.parameters
              .map((entry) => normalizeBuiltInHoverParameter(entry))
              .filter((entry): entry is BuiltInHoverParameter => entry !== null) as ReadonlyArray<
              BuiltInHoverParameter
          >)
        : [];

    return Object.freeze({
        signature: getStringField(record, "signature"),
        description: getStringField(record, "description"),
        parameters,
        returnType: getStringField(record, "returnType")
    });
}

/**
 * Resolve the normalized hover contract for a built-in identifier name.
 *
 * Result memoization keeps hot paths (LSP hover requests, completion detail)
 * from re-walking the descriptor shape on every invocation. The cache records
 * both populated payloads and explicit null results so callers that probe
 * many identifiers only pay the normalization cost once per identifier.
 *
 * @param identifier Built-in identifier name to look up.
 * @returns Normalized hover info or null when the identifier is unknown or
 *          carries no hover metadata.
 */
export function getBuiltInHoverInfo(identifier: string): BuiltInHoverInfo | null {
    if (cachedBuiltInHoverInfo.has(identifier)) {
        return cachedBuiltInHoverInfo.get(identifier) ?? null;
    }

    const metadata = loadIdentifierMetadata();
    if (!isPlainObject(metadata)) {
        cachedBuiltInHoverInfo.set(identifier, null);
        return null;
    }

    const identifiers = (metadata as { identifiers?: unknown }).identifiers;
    if (!isPlainObject(identifiers)) {
        cachedBuiltInHoverInfo.set(identifier, null);
        return null;
    }

    const descriptor = (identifiers as Record<string, unknown>)[identifier];
    if (!isPlainObject(descriptor)) {
        cachedBuiltInHoverInfo.set(identifier, null);
        return null;
    }

    const hover = normalizeBuiltInHoverInfo((descriptor as Record<string, unknown>).hover);
    cachedBuiltInHoverInfo.set(identifier, hover);
    return hover;
}
