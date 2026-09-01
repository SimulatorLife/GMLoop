/**
 * Centralized catalog of supported graph-label rendering modes.
 *
 * The graph view exposes three user-selectable label modes (`"always"`,
 * `"auto"`, `"hidden"`) that previously branched on raw string literals
 * inside `shouldRenderGraphLabels`. That branching silently fell through to
 * the `"auto"` behaviour whenever an unknown value was supplied, which made
 * typos and accidental string drift impossible to detect at runtime.
 *
 * This module replaces the ad-hoc comparisons with a typed catalogue that:
 *
 *   - declares the canonical ordered tuple of supported modes
 *     (`GRAPH_RENDER_LABEL_MODES`),
 *   - derives a fast `ReadonlySet` membership check
 *     (`GRAPH_RENDER_LABEL_MODE_VALUES`),
 *   - exposes a type guard (`isGraphRenderLabelMode`) and a parser
 *     (`parseGraphRenderLabelMode`) so call sites can validate untrusted
 *     input without needing bespoke string matching, and
 *   - lets `shouldRenderGraphLabels` use a switch with an exhaustive
 *     `default` branch so unknown values fail fast with a descriptive error
 *     rather than silently defaulting to the `"auto"` zoom heuristic.
 */

/**
 * Canonical ordered list of supported label rendering modes.
 *
 * The `as const` annotation makes the literal types survive inference so that
 * {@link GraphRenderLabelMode} derives the union straight from this tuple —
 * the compile-time union and the runtime membership check therefore cannot
 * drift apart.
 */
export const GRAPH_RENDER_LABEL_MODES = ["always", "auto", "hidden"] as const;

/**
 * User-selectable label rendering mode for the graph visualization.
 *
 * Derived from {@link GRAPH_RENDER_LABEL_MODES} so adding a new mode is a
 * one-line change in the tuple — TypeScript will then enforce that every
 * `switch`/`if` branch covering this union is updated to handle it.
 */
export type GraphRenderLabelMode = (typeof GRAPH_RENDER_LABEL_MODES)[number];

/**
 * Set form of {@link GRAPH_RENDER_LABEL_MODES} for O(1) membership checks.
 *
 * Derived from the tuple so that introducing a new label mode automatically
 * updates both the iteration order and the membership set without any chance
 * of drift.
 */
export const GRAPH_RENDER_LABEL_MODE_VALUES: ReadonlySet<GraphRenderLabelMode> = new Set(GRAPH_RENDER_LABEL_MODES);

/**
 * Type guard that narrows an arbitrary value to a {@link GraphRenderLabelMode}.
 *
 * Returns a type guard (rather than throwing) so call sites can decide how to
 * react to invalid input — typically by falling back to a default — without
 * wrapping each validation in a `try`/`catch`.
 */
export function isGraphRenderLabelMode(value: unknown): value is GraphRenderLabelMode {
    return typeof value === "string" && GRAPH_RENDER_LABEL_MODE_VALUES.has(value as GraphRenderLabelMode);
}

/**
 * Validate a raw string (typically the `value` of an HTML `<option>` element
 * or a deserialized URL parameter) and return a {@link GraphRenderLabelMode},
 * or `null` when the string is not one of the supported label modes.
 *
 * Centralising the parse here means raw literal comparisons can never drift
 * from the canonical mode list — adding `"on"` or `"off"` to
 * {@link GRAPH_RENDER_LABEL_MODES} is enough to make the new value flow
 * through every call site automatically.
 */
export function parseGraphRenderLabelMode(value: unknown): GraphRenderLabelMode | null {
    return isGraphRenderLabelMode(value) ? value : null;
}
