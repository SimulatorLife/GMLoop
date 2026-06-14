import type { GraphVisualizationUiPage } from "../state/types.js";

/**
 * Decisions the toolbar keyboard policy can return for a given keystroke.
 *
 * The policy never performs side effects; the toolbar consumes an action and
 * is responsible for calling `event.preventDefault()` and dispatching the
 * corresponding custom event. Keeping the action vocabulary declarative makes
 * the policy exhaustively testable without a live DOM.
 */
export type ToolbarKeyboardShortcutAction =
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "clear-search" }>
    | Readonly<{ kind: "toggle-graph-view" }>
    | Readonly<{ kind: "cycle-label-mode" }>
    | Readonly<{ kind: "reset-defaults" }>
    | Readonly<{ kind: "navigate-page"; page: GraphVisualizationUiPage }>;

/**
 * Pure inputs the policy needs to decide which shortcut (if any) applies.
 *
 * The toolbar assembles a context from the current `KeyboardEvent` and UI
 * state; the policy itself never reads from either source. This separation
 * ensures every code path inside the evaluator can be exercised by unit
 * tests that pass a plain object.
 */
export type ToolbarKeyboardShortcutContext = Readonly<{
    canUseGraphControls: boolean;
    hasModifier: boolean;
    hasSearchQuery: boolean;
    isTextEntryTarget: boolean;
    key: string;
}>;

/**
 * Keys that require a loaded graph index to take effect. Other page
 * navigation keys remain available so users can leave the graph surface
 * even when it has not finished loading.
 */
const GRAPH_SCOPED_SHORTCUT_KEYS: ReadonlySet<string> = new Set(["g", "l", "r", "1"]);

/**
 * Return the deepest DOM target that received the keyboard event.
 *
 * `composedPath` reflects the retargeted event path used by shadow DOM and
 * Lit light-DOM, which is more reliable than `event.target` for events that
 * cross component boundaries.
 */
export function resolveKeyboardShortcutTarget(event: KeyboardEvent): EventTarget | null {
    const eventPath = event.composedPath();
    return eventPath.length > 0 ? (eventPath[0] ?? event.target) : event.target;
}

/**
 * Build the "navigate to page" action for the supplied target page.
 *
 * Funnelling the discriminator literal through a single helper keeps the
 * `ToolbarKeyboardShortcutAction` union literal type intact while avoiding
 * repetition of the `"navigate-page"` string across the binding table.
 */
function navigateToPageAction(page: GraphVisualizationUiPage): ToolbarKeyboardShortcutAction {
    return { kind: "navigate-page", page };
}

/**
 * Decide which toolbar action (if any) should be taken for a keyboard event.
 *
 * Order of evaluation matters and matches the original inline behaviour:
 *
 * 1. `Escape` with a non-empty search query clears the search even when a
 *    modifier is held or focus is inside a text entry control. This lets
 *    users dismiss the docs search without leaving their input.
 * 2. Modifier keys (`Alt`, `Meta`, `Ctrl`) suppress all other shortcuts.
 * 3. Text entry controls (inputs, textareas, selects, content editable
 *    regions) suppress all other shortcuts.
 * 4. The remaining keys map to a specific toolbar action; graph-scoped
 *    shortcuts are additionally gated on `canUseGraphControls`.
 */
export function evaluateToolbarKeyboardShortcut(
    context: ToolbarKeyboardShortcutContext
): ToolbarKeyboardShortcutAction {
    if (context.key === "Escape" && context.hasSearchQuery) {
        return { kind: "clear-search" };
    }

    if (context.hasModifier || context.isTextEntryTarget) {
        return { kind: "none" };
    }

    const normalizedKey = context.key.toLowerCase();

    if (GRAPH_SCOPED_SHORTCUT_KEYS.has(normalizedKey) && !context.canUseGraphControls) {
        return { kind: "none" };
    }

    switch (normalizedKey) {
        case "g": {
            return { kind: "toggle-graph-view" };
        }
        case "l": {
            return { kind: "cycle-label-mode" };
        }
        case "r": {
            return { kind: "reset-defaults" };
        }
        case "1": {
            return navigateToPageAction("graph");
        }
        case "2": {
            return navigateToPageAction("docs");
        }
        case "3": {
            return navigateToPageAction("config");
        }
        case "4": {
            return navigateToPageAction("fix");
        }
        case "5": {
            return navigateToPageAction("playground");
        }
        case "6": {
            return navigateToPageAction("mcp");
        }
        case "7": {
            return navigateToPageAction("live-reload");
        }
        default: {
            return { kind: "none" };
        }
    }
}
