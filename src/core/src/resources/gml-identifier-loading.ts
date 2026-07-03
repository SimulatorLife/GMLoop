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
 * GML binding position used when checking whether a language identifier is
 * unavailable as a newly declared name.
 */
export type GmlBindingIdentifierContext = "ordinary-binding" | "argument-binding" | "enum-member";

const ARGUMENT_BINDING_RESERVED_IDENTIFIER_NAMES: ReadonlySet<string> = new Set(["id", "self", "other", "global"]);
const ORDINARY_BINDING_MANUAL_IDENTIFIER_NAMES: ReadonlyArray<string> = Object.freeze(["id"]);
const ENUM_MEMBER_RESERVED_IDENTIFIER_TYPES: ReadonlySet<string> = new Set(["keyword", "literal"]);
const cachedReservedBindingIdentifierNames = new Map<GmlBindingIdentifierContext, ReadonlySet<string>>();

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
 * Also clears derived caches (function names, reserved identifiers).
 */
export function clearIdentifierMetadataCache() {
    cachedIdentifierMetadata = null;
    cachedDeprecatedIdentifierEntries = null;
    cachedManualFunctionNames = null;
    cachedReservedIdentifierNames.clear();
    cachedReservedBindingIdentifierNames.clear();
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
            names.add(normalizedName.toLowerCase());
        }
    }

    // Evict LRU entry if at capacity before inserting
    evictLruIfNeeded();
    cachedReservedIdentifierNames.set(cacheKey, names);
    return names;
}

function getNormalizedIdentifierEntries() {
    return normalizeIdentifierMetadataEntries(loadIdentifierMetadata());
}

function addManualIdentifierNames(names: Set<string>, manualNames: ReadonlyArray<string>): void {
    for (const name of manualNames) {
        names.add(name.toLowerCase());
    }
}

function loadOrdinaryBindingReservedIdentifierNames(): ReadonlySet<string> {
    const names = new Set(loadReservedIdentifierNames({ disallowedTypes: [] }));
    addManualIdentifierNames(names, ORDINARY_BINDING_MANUAL_IDENTIFIER_NAMES);
    return names;
}

function loadArgumentBindingReservedIdentifierNames(): ReadonlySet<string> {
    const names = new Set<string>();

    for (const { name } of getNormalizedIdentifierEntries()) {
        const normalizedName = name.toLowerCase();
        if (ARGUMENT_BINDING_RESERVED_IDENTIFIER_NAMES.has(normalizedName)) {
            names.add(normalizedName);
        }
    }

    addManualIdentifierNames(names, ORDINARY_BINDING_MANUAL_IDENTIFIER_NAMES);
    return names;
}

function loadEnumMemberReservedIdentifierNames(): ReadonlySet<string> {
    const names = new Set<string>();

    for (const { name, type } of getNormalizedIdentifierEntries()) {
        if (ENUM_MEMBER_RESERVED_IDENTIFIER_TYPES.has(type.toLowerCase())) {
            names.add(name.toLowerCase());
        }
    }

    return names;
}

/**
 * Load language-level GML identifiers that cannot be introduced in a binding
 * position represented by `context`.
 *
 * This is intentionally limited to static language facts derived from the
 * bundled GameMaker identifier metadata. Callers remain responsible for
 * semantic checks such as scope collisions, symbol resolution, and refactor
 * diagnostics.
 *
 * @param context Binding position to classify.
 * @returns Cached lower-case reserved identifier names for the context.
 */
export function loadReservedGmlBindingIdentifierNames(
    context: GmlBindingIdentifierContext
): ReadonlySet<string> {
    const cached = cachedReservedBindingIdentifierNames.get(context);
    if (cached) {
        return cached;
    }

    let names: ReadonlySet<string>;
    switch (context) {
        case "ordinary-binding": {
            names = loadOrdinaryBindingReservedIdentifierNames();
            break;
        }
        case "argument-binding": {
            names = loadArgumentBindingReservedIdentifierNames();
            break;
        }
        case "enum-member": {
            names = loadEnumMemberReservedIdentifierNames();
            break;
        }
    }

    cachedReservedBindingIdentifierNames.set(context, names);
    return names;
}

/**
 * Check whether `name` is reserved in a static GML binding context.
 *
 * Names are compared case-insensitively because GameMaker identifiers are
 * case-insensitive for these language-level conflicts.
 *
 * @param name Candidate identifier name.
 * @param context Binding position to classify.
 * @returns True when `name` is reserved in the supplied context.
 */
export function isReservedGmlBindingIdentifierName(name: string, context: GmlBindingIdentifierContext): boolean {
    return loadReservedGmlBindingIdentifierNames(context).has(name.toLowerCase());
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
