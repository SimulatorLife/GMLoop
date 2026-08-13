import { isProjectManifestPath, isProjectResourceMetadataPath } from "./constants.js";

const PROJECT_SOURCE_EXTENSION = ".gml";
const PROJECT_INDEX_SOURCE_EXTENSIONS = Object.freeze([PROJECT_SOURCE_EXTENSION]);

export const ProjectFileCategory = Object.freeze({
    RESOURCE_METADATA: "yy",
    SOURCE: "gml"
});

type ProjectFileCategoryValue = (typeof ProjectFileCategory)[keyof typeof ProjectFileCategory];

const PROJECT_FILE_CATEGORIES = new Set<ProjectFileCategoryValue>(Object.values(ProjectFileCategory));

const PROJECT_FILE_CATEGORY_CHOICES = Object.freeze(
    [...PROJECT_FILE_CATEGORIES].toSorted((left, right) => left.localeCompare(right)).join(", ")
);

/**
 * Retrieve the canonical source extension list used by project indexing.
 *
 * GameMaker source files are always `.gml`; the semantic project index mirrors
 * that language contract instead of accepting custom suffixes that the parser,
 * formatter, and downstream tools do not support.
 *
 * @returns {readonly string[]} Frozen list containing only `.gml`.
 */
export function getProjectIndexSourceExtensions() {
    return PROJECT_INDEX_SOURCE_EXTENSIONS;
}

/**
 * Validate a potential project file category and normalize it to one of the
 * known constants.
 *
 * @param {unknown} value Candidate category value.
 * @returns {ProjectFileCategory} Normalized category when valid.
 * @throws {RangeError} When `value` does not map to a known category.
 */
export function normalizeProjectFileCategory(value: unknown): ProjectFileCategoryValue {
    if (value === ProjectFileCategory.RESOURCE_METADATA || value === ProjectFileCategory.SOURCE) {
        return value;
    }

    const received = value === undefined ? "undefined" : `'${String(value)}'`;
    throw new RangeError(
        `Project file category must be one of: ${PROJECT_FILE_CATEGORY_CHOICES}. Received ${received}.`
    );
}

/**
 * Determine the project category for a path relative to the project root.
 * Resource metadata files (`.yy` and the project manifest) are detected first,
 * then the fixed `.gml` source suffix.
 *
 * @param {string} relativePosix Project-relative path using POSIX separators.
 * @returns {ProjectFileCategory | null} Matching category or `null` when the
 *          path does not fall into a known bucket.
 */
export function resolveProjectFileCategory(relativePosix) {
    if (isProjectResourceMetadataPath(relativePosix) || isProjectManifestPath(relativePosix)) {
        return ProjectFileCategory.RESOURCE_METADATA;
    }

    if (relativePosix.toLowerCase().endsWith(PROJECT_SOURCE_EXTENSION)) {
        return ProjectFileCategory.SOURCE;
    }

    return null;
}
