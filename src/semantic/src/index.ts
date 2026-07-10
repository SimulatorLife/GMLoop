// Import all domain modules with namespace prefixes to organize the public API
import * as GraphIndex from "./graph-index/index.js";
import * as Highlighting from "./highlighting/index.js";
import * as IdentifierCase from "./identifier-case/index.js";
import * as Navigation from "./navigation/index.js";
import * as ProjectIndex from "./project-index/index.js";
import * as Scopes from "./scopes/index.js";
import * as Symbols from "./symbols/index.js";

// Export the flattened Semantic namespace with nested namespace access.
// Follows the same pattern as Core: flat access for common usage, nested
// namespaces available for explicit grouping when needed.
export const Semantic = Object.freeze({
    ...GraphIndex,
    ...Highlighting,
    ...IdentifierCase,
    ...Navigation,
    ...ProjectIndex,
    ...Scopes,
    ...Symbols,
    GraphIndex,
    Highlighting,
    IdentifierCase,
    Navigation,
    ProjectIndex,
    Scopes,
    Symbols
});
