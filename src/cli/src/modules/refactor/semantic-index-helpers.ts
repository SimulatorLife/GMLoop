import { Core } from "@gmloop/core";

/**
 * Extracts a numeric character index from a semantic project-index location value.
 *
 * Location values in the semantic project index appear in two forms:
 * - A plain number (the index itself, produced by parser AST nodes when
 *   `simplifyLocations: true`).
 * - An object with a numeric `index` property (e.g. `{ index: 42, line: 3,
 *   column: 10 }`), produced when `simplifyLocations: false`.
 *
 * Returns `null` when the input matches neither form.
 */
export function readSemanticLocationIndex(location: unknown): number | null {
    if (typeof location === "number") {
        return location;
    }

    if (!Core.isObjectLike(location)) {
        return null;
    }

    const record = location as { index?: unknown };
    return typeof record.index === "number" ? record.index : null;
}

/**
 * Like {@link readSemanticLocationIndex}, but converts the inclusive end index
 * stored by the semantic project index into the exclusive (one-past-the-end)
 * form expected by refactor text-edit ranges and `string.slice()`.
 *
 * Returns `null` when the input does not encode a valid index.
 */
export function readExclusiveSemanticLocationIndex(location: unknown): number | null {
    const index = readSemanticLocationIndex(location);
    return index === null ? null : index + 1;
}
