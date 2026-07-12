import { Core } from "@gmloop/core";
import type { ParserOptions } from "@gmloop/parser";
import * as Parser from "@gmloop/parser";

import { SemanticScopeCoordinator } from "../scopes/identifier-scope.js";
import { formatProjectIndexSyntaxError } from "./syntax-error-formatter.js";

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

function parseProjectIndexSource(sourceText: string, context: Record<string, unknown> = {}) {
    const parserApi = resolveParserNamespace();

    try {
        const parserOptions: Partial<ParserOptions> = {
            // Semantic documentation is an AST fact. Keeping comments through the
            // parser attachment pass prevents hover from reopening declaration files.
            getComments: true,
            getLocations: true,
            simplifyLocations: false,
            attachFunctionDocComments: true,
            astFormat: "gml",
            asJSON: false,
            scopeTrackerOptions: {
                enabled: true,
                getIdentifierMetadata: true,
                createScopeTracker: createProjectIndexScopeCoordinator
            }
        };
        return parserApi.GMLParser.parse(sourceText, parserOptions);
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

type ProjectIndexParserResolverOptions = {
    parseGml?: ((sourceText: string, context?: unknown) => unknown) | null;
};

export function resolveProjectIndexParser(options: ProjectIndexParserResolverOptions | null = null) {
    return options?.parseGml ?? defaultProjectIndexParser;
}

export function isRecoverableProjectIndexParseError(error: unknown): boolean {
    return Core.getErrorMessage(error).includes("Syntax Error (");
}

export function createTolerantProjectIndexParser(
    baseParser: (sourceText: string, context?: any) => any,
    onWarning?: (filePath: string, errorMessage: string) => void
): (sourceText: string, context?: any) => any {
    const skippedFilePaths = new Set<string>();
    return (sourceText: string, context: { filePath?: string } = {}) => {
        try {
            return baseParser(sourceText, context);
        } catch (error) {
            if (!isRecoverableProjectIndexParseError(error)) {
                throw error;
            }

            const filePath = context.filePath ?? "<unknown>";
            if (!skippedFilePaths.has(filePath)) {
                skippedFilePaths.add(filePath);
                if (onWarning) {
                    onWarning(filePath, Core.getErrorMessage(error));
                }
            }

            return baseParser("", context);
        }
    };
}
