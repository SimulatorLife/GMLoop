import { Core } from "@gmloop/core";

export const PROJECT_MANIFEST_EXTENSION = ".yyp";

const PROJECT_MANIFEST_EXTENSION_LOWER = PROJECT_MANIFEST_EXTENSION.toLowerCase();

/**
 * Canonical suffixes treated as GameMaker resource metadata. The formatter
 * keeps this list opinionated by default and only expands it when callers
 * explicitly opt in via the extension hook.
 */
const DEFAULT_RESOURCE_METADATA_EXTENSIONS = Object.freeze([".yy"]);

let projectResourceMetadataExtensions = DEFAULT_RESOURCE_METADATA_EXTENSIONS;

function normalizeResourceMetadataExtension(candidate) {
    return Core.normalizeExtensionSuffix(candidate);
}

function _normalizeResourceMetadataExtensions(candidate) {
    const entries = typeof candidate === "string" ? [candidate] : candidate;

    const normalized = Core.mergeUniqueValues(DEFAULT_RESOURCE_METADATA_EXTENSIONS, entries, {
        coerce: normalizeResourceMetadataExtension,
        freeze: false
    });

    if (normalized.length === DEFAULT_RESOURCE_METADATA_EXTENSIONS.length) {
        return DEFAULT_RESOURCE_METADATA_EXTENSIONS;
    }

    return Object.freeze(normalized);
}

/**
 * Return the normalized metadata extension when a candidate path matches one of
 * the registered suffixes. The result keeps comparisons case-insensitive while
 * allowing callers to trim the original value predictably.
 */
export function matchProjectResourceMetadataExtension(candidate) {
    if (typeof candidate !== "string" || candidate.length === 0) {
        return null;
    }

    const lowerCandidate = candidate.toLowerCase();
    for (const extension of projectResourceMetadataExtensions) {
        if (lowerCandidate.endsWith(extension)) {
            return extension;
        }
    }

    return null;
}

/**
 * Return the frozen list of recognized resource metadata extensions. The array
 * always exposes the canonical `.yy` suffix first so diagnostics remain
 * predictable.
 */
export function getProjectResourceMetadataExtensions() {
    return projectResourceMetadataExtensions;
}

/**
 * Restore the resource metadata extension list to its default contents. Useful
 * for tests that temporarily override the recognized suffixes.
 */
export function resetProjectResourceMetadataExtensions() {
    projectResourceMetadataExtensions = DEFAULT_RESOURCE_METADATA_EXTENSIONS;
    return projectResourceMetadataExtensions;
}

/**
 * Determine whether a path ends with a recognized resource metadata suffix.
 */
export function isProjectResourceMetadataPath(candidate) {
    return matchProjectResourceMetadataExtension(candidate) !== null;
}

export function isProjectManifestPath(candidate) {
    if (typeof candidate !== "string") {
        return false;
    }

    if (candidate.length === 0) {
        return false;
    }

    return candidate.toLowerCase().endsWith(PROJECT_MANIFEST_EXTENSION_LOWER);
}

export { DEFAULT_RESOURCE_METADATA_EXTENSIONS as PROJECT_RESOURCE_METADATA_DEFAULTS };
