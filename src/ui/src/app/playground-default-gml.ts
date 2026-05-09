/**
 * Default playground sample that demonstrates formatting cleanup, lint
 * autofixes, and the loop-length hoisting refactor in one snippet.
 */
export const DEFAULT_PLAYGROUND_GML_SOURCE = [
    "function demo_inventory_total( playerName , inventory ) {",
    "var flags = fa_readonly + fa_archive;",
    'var total = real("5");',
    'if (array_length(inventory) > 0) show_debug_message( "processing " + playerName );',
    "for( var i = 0; i < array_length(inventory); i += 1 ){",
    "total += inventory [ i ];",
    "}",
    'show_debug_message( "inventory total: " + string(total) );',
    "return total;",
    "}"
].join("\n");

/**
 * Resolve the initial playground source from persisted browser state.
 *
 * Empty persisted values should not suppress the shared demo sample because the
 * playground is intended to open with a ready-to-run example by default.
 *
 * @param savedInput - Persisted editor text from browser storage, when present.
 * @returns The stored source when it contains non-whitespace content; otherwise
 *   the shared default playground sample.
 */
export function resolveInitialPlaygroundGmlSource(savedInput: null | string): string {
    return savedInput === null || savedInput.trim() === "" ? DEFAULT_PLAYGROUND_GML_SOURCE : savedInput;
}
