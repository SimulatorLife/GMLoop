// Import all domain modules with namespace prefixes to organize the public API
import * as GraphIndex from "./graph-index/index.js";
import * as IdentifierCase from "./identifier-case/index.js";
import * as ProjectIndex from "./project-index/index.js";
import * as Scopes from "./scopes/index.js";
import * as Symbols from "./symbols/index.js";

// Export the flattened Semantic namespace with nested namespace access.
// Follows the same pattern as Core: flat access for common usage, nested
// namespaces available for explicit grouping when needed.
export const Semantic = Object.freeze({
    ...GraphIndex,
    ...IdentifierCase,
    ...ProjectIndex,
    ...Scopes,
    ...Symbols,
    GraphIndex,
    IdentifierCase,
    ProjectIndex,
    Scopes,
    Symbols
});
