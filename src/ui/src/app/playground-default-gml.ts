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
