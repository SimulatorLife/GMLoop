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

let parserNamespace: ParserNamespace | null = null;
function defaultProjectIndexParser(sourceText: string, context = {}) {
    return parseProjectIndexSource(sourceText, context);
}
const createProjectIndexScopeCoordinator = () => new SemanticScopeCoordinator();

export function setProjectIndexParserNamespace(parser: ParserNamespace): void {
    parserNamespace = parser;
}

function resolveParserNamespace(): ParserNamespace {
    if (!parserNamespace && Parser.Parser) {
        parserNamespace = Parser.Parser;
    }

    if (parserNamespace) {
        return parserNamespace;
    }

    throw new Error("Parser namespace is not initialized; call setProjectIndexParserNamespace first.");
}

function parseProjectIndexSource(sourceText: string, context = {}) {
    const parserApi = resolveParserNamespace();

    try {
        // WORKAROUND: Keep the parser call behind a single `as any` boundary while
        // ParserOptions is being unified across workspaces.
        //
        // CONTEXT: The ParserOptions interface is evolving across multiple packages
        // (parser, semantic, format) as the parser is being rebuilt. During this
        // transition, the options object may have fields that exist at runtime but
        // don't match the compile-time type definitions in all workspaces.
        //
        // SOLUTION: We cast the options to 'any' and pass the runtime values we need
        // (getComments, getLocations, etc.) from this one adapter instead of leaking
        // ad-hoc casts across semantic callers. Centralizing the mismatch here keeps
        // the parser/semantic boundary auditable and aligned with the workspace
        // ownership rules in docs/target-state.md (see "2. Workspace Ownership
        // Boundaries"), so future cleanup can remove one seam instead of many.
        //
        // WHAT WOULD BREAK: Removing this cast before the parser rebuild is complete
        // would force every parser call site in semantic to add duplicate unsafe
        // casts, and TypeScript compilation would fail in whichever workspace first
        // sees the temporary type drift.
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
                createScopeTracker: createProjectIndexScopeCoordinator
            }
        } as any);
    } catch (error) {
        if (Core.isSyntaxErrorWithLocation(error)) {
            throw formatProjectIndexSyntaxError(error, sourceText, context);
        }

        throw error;
    }
}

export function getDefaultProjectIndexParser() {
    return defaultProjectIndexParser;
}

function resolveProjectIndexParserOverride(options): ((sourceText: string, context?: unknown) => unknown) | null {
    if (!Core.isObjectLike(options)) {
        return null;
    }

    const parse = options.parseGml;
    return typeof parse === "function" ? parse : null;
}

export function resolveProjectIndexParser(options) {
    return resolveProjectIndexParserOverride(options) ?? defaultProjectIndexParser;
}
