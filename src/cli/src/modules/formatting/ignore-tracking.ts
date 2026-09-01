import { Core } from "@gmloop/core";

const { isNonEmptyString } = Core;

/**
 * Tracks per-formatting-session ignore state: which ignore file paths have
 * already been registered, and whether any of them contained a negated
 * pattern (starting with `!`). Both are reset between formatting runs.
 */
const state = {
    paths: new Set<string>(),
    hasNegatedRules: false
};

/** Determine whether the provided path has already been registered. */
export function hasRegisteredIgnorePath(ignorePath: string | null | undefined): boolean {
    return isNonEmptyString(ignorePath) && state.paths.has(ignorePath);
}

/** Track a path that should be respected by CLI commands invoking Prettier. */
export function registerIgnorePath(ignorePath: string | null | undefined): void {
    if (isNonEmptyString(ignorePath)) {
        state.paths.add(ignorePath);
    }
}

/** Remove all previously registered ignore paths. */
export function resetRegisteredIgnorePaths(): void {
    state.paths.clear();
}

/** Count the number of active ignore path registrations. */
export function getRegisteredIgnorePathCount(): number {
    return state.paths.size;
}

/** Take a snapshot of the registered ignore paths, in registration order. */
export function getRegisteredIgnorePathsSnapshot(): Array<string> {
    return [...state.paths];
}

/** Check whether any registered ignore file contained a negated (`!`) pattern. */
export function hasNegatedIgnoreRules(): boolean {
    return state.hasNegatedRules;
}

/** Reset the negated-ignore-rules flag; called during session initialization. */
export function resetNegatedIgnoreRulesFlag(): void {
    state.hasNegatedRules = false;
}

/** Mark that a scanned ignore file contained a negated (`!`) pattern. */
export function markNegatedIgnoreRulesDetected(): void {
    state.hasNegatedRules = true;
}
