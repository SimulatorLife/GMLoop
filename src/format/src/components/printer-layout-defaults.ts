/**
 * Canonical printer layout defaults surfaced as a dependency-inversion seam.
 *
 * `printWidth` and `tabWidth` are owned by the printer workspace and
 * declared once in `../printer/constants.ts`. High-level orchestration
 * code (the option catalog in `options/project-config-catalog.ts`, the
 * resolver in `default-format-adapters.ts`) needs to consume these
 * values without reaching into the printer directory directly.
 *
 * This module is the dedicated seam for that consumption. It only
 * imports from `printer/constants.ts`, so callers do not pay for — and
 * are not coupled to — the heavier printer adapter surface that
 * `default-format-adapters.ts` aggregates. The seam is intentionally
 * kept narrow (just the two layout numbers) so the shape stays stable
 * and the dependency graph remains acyclic.
 *
 * (target-state.md §2.3, §3.2 — orchestration depends on abstractions,
 * not concrete adapters.)
 */
import { DEFAULT_PRINT_WIDTH, DEFAULT_TAB_WIDTH } from "../printer/constants.js";

export type GmlPrinterLayoutDefaults = Readonly<{
    printWidth: number;
    tabWidth: number;
}>;

/**
 * Default printer layout values sourced from the printer workspace's
 * single source of truth (`printer/constants.ts`). Frozen so callers
 * cannot mutate the shared reference.
 */
export const DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS: GmlPrinterLayoutDefaults = Object.freeze({
    printWidth: DEFAULT_PRINT_WIDTH,
    tabWidth: DEFAULT_TAB_WIDTH
});
