import * as AST from "./ast/index.js";
import * as GMLParserModule from "./gml-parser.js";
import * as Runtime from "./runtime/index.js";

// Re-export stable facade for generated parser base classes. External consumers
// should depend on these factory functions rather than importing from the
// generated directory directly, keeping coupling isolated to the abstraction layer.
export const GameMakerLanguageParserListenerBase = Runtime.getParserListenerBase();
export const GameMakerLanguageParserVisitorBase = Runtime.getParserVisitorBase();

// Export the flattened Parser namespace for external consumers. The namespace
// re-exports everything from the parser package (GMLParser, AST, Runtime).
export const Parser = Object.freeze({
    ...GMLParserModule,
    ...AST,
    ...Runtime,
    AST,
    Runtime
}) as typeof GMLParserModule & typeof AST & typeof Runtime & { AST: typeof AST; Runtime: typeof Runtime };

// Export types from the parser for consumer packages to import without deep
// imports. This mirrors `Core`'s exported types and keeps package roots
// stable for other workspaces.
export type { ParserOptions, ScopeTracker } from "./types/parser-types.js";
