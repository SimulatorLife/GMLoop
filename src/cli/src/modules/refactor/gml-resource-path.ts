import path from "node:path";

const REFRACTOR_RESOURCE_EXTENSIONS = Object.freeze([".gml", ".yy"]);

/**
 * Check whether a path points to a refactor-owned source/metadata file type.
 *
 * The refactor workflow traverses both script sources (`.gml`) and owner
 * metadata files (`.yy`). Keeping this extension logic in one place prevents
 * drift between directory walks, path predicates, and semantic-index filters.
 *
 * @param {string} candidatePath Candidate path to classify.
 * @returns {boolean} `true` when the path ends with `.gml` or `.yy`.
 */
export function isRefactorResourcePath(candidatePath: string): boolean {
    const normalizedPath = candidatePath.trim();
    if (normalizedPath.length === 0) {
        return false;
    }

    const normalizedExtension = path.extname(normalizedPath).toLowerCase();
    return REFRACTOR_RESOURCE_EXTENSIONS.includes(normalizedExtension);
}

/**
 * Check whether a path points to a GameMaker owner metadata file (`.yy`).
 *
 * @param {string} candidatePath Candidate path to classify.
 * @returns {boolean} `true` when the path ends with `.yy`.
 */
export function isRefactorOwnerMetadataPath(candidatePath: string): boolean {
    return path.extname(candidatePath).toLowerCase() === ".yy";
}
