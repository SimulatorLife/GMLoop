import { Core } from "@gmloop/core";
import * as Parser from "@gmloop/parser";

import { SemanticScopeCoordinator } from "../scopes/identifier-scope.js";
import { formatProjectIndexSyntaxError } from "./parsing/syntax-error-formatter.js";

/**
 * Parser facade adapter for the project-index subsystem.
 *
 * ARCHITECTURE NOTE: This module exists as a temporary decoupling layer to manage
 * a circular dependency between the 'parser' and 'semantic' packages during the
 * ongoing parser rebuild. Ideally, dependencies should flow in one direction:
 *   Core ← Parser ← Semantic ← Format
 *
 * However, the current implementation requires 'semantic' to invoke the parser for
 * project-wide indexing, while the parser also depends on 'semantic' for scope
 * tracking during the parse phase. This creates a cycle.
 *
 * LONG-TERM PLAN: Once the parser is fully rebuilt and scope tracking is moved
 * entirely to the 'semantic' layer (or made optional in the parser), this facade
 * can be removed. At that point:
 *   1. 'Semantic' will import '@gmloop/parser' directly.
 *   2. The parser will not depend on 'semantic' at all.
 *   3. Scope analysis will happen as a post-parse step in 'semantic'.
 *
 * WHAT WOULD BREAK: Removing this facade before the parser rebuild is complete
 * would cause import cycles and build failures. Do not remove until the parser
 * no longer requires semantic imports.
 */
type ParserNamespace = typeof Parser.Parser;
type ProjectIndexParser = (sourceText: string, context?: unknown) => unknown;

let parserNamespace: ParserNamespace | null = null;
const defaultProjectIndexParser: ProjectIndexParser = (sourceText: string, context = {}) =>
    parseProjectIndexSource(sourceText, context);

export function setProjectIndexParserNamespace(parser: ParserNamespace): void {
    parserNamespace = parser;
}

function resolveParserNamespace(parser?: ParserNamespace): ParserNamespace {
    if (parser) {
        return parser;
    }

    if (!parserNamespace && Parser.Parser) {
        parserNamespace = Parser.Parser;
    }

    if (parserNamespace) {
        return parserNamespace;
    }

    throw new Error("Parser namespace is not initialized; call setProjectIndexParserNamespace first.");
}

function parseProjectIndexSource(sourceText: string, context = {}, parser: ParserNamespace | null = null) {
    const parserApi = resolveParserNamespace(parser);

    try {
        // WORKAROUND: Type-cast to 'any' to bypass ParserOptions type mismatches
        // during incremental refactoring.
        //
        // CONTEXT: The ParserOptions interface is evolving across multiple packages
        // (parser, semantic, format) as the parser is being rebuilt. During this
        // transition, the options object may have fields that exist at runtime but
        // don't match the compile-time type definitions in all workspaces.
        //
        // SOLUTION: We cast the options to 'any' and pass the runtime values we need
        // (getComments, getLocations, etc.), trusting that the parser implementation
        // will handle them correctly even if the type signature is temporarily out of sync.
        //
        // WHAT WOULD BREAK: Removing this cast before the parser rebuild is complete
        // would cause TypeScript compilation errors due to incompatible option types
        // between packages.
        //
        // LONG-TERM FIX: Once the parser package is stable and all packages share a
        // consistent ParserOptions type, remove this cast and use the properly-typed
        // options object directly.
        return parserApi.GMLParser.parse(sourceText, {
            getComments: false,
            getLocations: true,
            simplifyLocations: false,
            astFormat: "gml",
            asJSON: false,
            scopeTrackerOptions: {
                enabled: true,
                getIdentifierMetadata: true,
                createScopeTracker: () => new SemanticScopeCoordinator()
            }
        } as any);
    } catch (error) {
        if (Core.isSyntaxErrorWithLocation(error)) {
            throw formatProjectIndexSyntaxError(error, sourceText, context);
        }

        throw error;
    }
}

export function getDefaultProjectIndexParser(parser: ParserNamespace | null = null) {
    return (sourceText: string, context = {}) => parseProjectIndexSource(sourceText, context, parser);
}

export function getProjectIndexParserOverride(options) {
    if (!Core.isObjectLike(options)) {
        return null;
    }

    const parse = options.parseGml;
    return typeof parse === "function" ? { parse } : null;
}

export function resolveProjectIndexParser(options) {
    return getProjectIndexParserOverride(options)?.parse ?? defaultProjectIndexParser;
}
