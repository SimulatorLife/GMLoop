/**
 * Factory module for refactor engine bridge adapters.
 *
 * Produces the parser, transpiler, and semantic bridge instances used by the
 * refactor engine.  Centralizing instantiation here keeps call-sites (CLI
 * commands, test helpers) free of direct `new` expressions on concrete adapter
 * classes, making it straightforward to swap or stub the bridges when needed.
 *
 * This module is the single seam through which the refactor cluster reaches
 * the `Parser` and `Transpiler` workspaces: it delegates to the canonical
 * `transpilation/adapters.ts` factory functions and pins the refactor-specific
 * parser options so the same configuration is applied on every call.
 *
 * Consumers that only need the default bridges can call {@link createRefactorBridges}
 * with no arguments.  Callers that need to inject test doubles or custom
 * adapters can pass them as options instead.
 */

import type { ParserOptions } from "@gmloop/parser";
import type * as Refactor from "@gmloop/refactor";
import type { PartialSemanticAnalyzer } from "@gmloop/refactor";

import {
    createGmlParserAdapter as createCanonicalGmlParserAdapter,
    createGmlTranspilerAdapter as createCanonicalGmlTranspilerAdapter
} from "../transpilation/adapters.js";
import { GmlParserBridge } from "./parser-bridge.js";
import { GmlSemanticBridge } from "./semantic-bridge.js";
import { GmlTranspilerBridge } from "./transpiler-bridge.js";

export interface RefactorBridges {
    formatter: Refactor.TranspilerBridge;
    parser: Refactor.ParserBridge;
    semantic: PartialSemanticAnalyzer;
}

export interface RefactorBridgesOptions {
    formatter?: Refactor.TranspilerBridge;
    parser?: Refactor.ParserBridge;
    semantic?: PartialSemanticAnalyzer;
}

/**
 * Parser options consumed by the refactor bridge factory.
 *
 * The refactor engine only needs source locations — it does not consume
 * comment metadata, doc-comment attachments, or alternate AST shapes — so the
 * factory pins the same options that this module previously passed inline to
 * `new Parser.GMLParser(...)`. Forwarding these options to the canonical
 * adapter guarantees behaviour parity with the prior implementation.
 */
const REFACTOR_BRIDGE_PARSER_OPTIONS: Readonly<ParserOptions> = Object.freeze({
    getComments: true,
    getLocations: true,
    simplifyLocations: true,
    attachFunctionDocComments: true,
    sllPredictionMaxSourceLength: 8000,
    astFormat: "gml",
    asJSON: false
});

/**
 * Create the complete set of bridge adapters for the refactor engine.
 *
 * When no options are supplied, returns the canonical production bridges.
 * Callers can override individual bridges for testing or when a custom
 * adapter is required.
 *
 * @param options - Optional overrides for any bridge.
 * @param projectRoot - Project root passed through to GmlSemanticBridge.
 *   Unused when a semantic bridge is supplied in options.
 */
export function createRefactorBridges(options: RefactorBridgesOptions = {}, projectRoot?: string): RefactorBridges {
    return Object.freeze({
        formatter: options.formatter ?? new GmlTranspilerBridge(createCanonicalGmlTranspilerAdapter()),
        parser: options.parser ?? new GmlParserBridge(createCanonicalGmlParserAdapter(REFACTOR_BRIDGE_PARSER_OPTIONS)),
        semantic: options.semantic ?? new GmlSemanticBridge({}, projectRoot ?? process.cwd())
    });
}
