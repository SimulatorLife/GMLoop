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

import { defaultParserOptions, type ParserOptions } from "@gmloop/parser";
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
    /**
     * Project root forwarded to the default semantic bridge. Ignored when a
     * custom `semantic` bridge is supplied.
     */
    projectRoot?: string;
}

/**
 * Parser options consumed by the refactor bridge factory.
 *
 * The refactor engine only needs source locations — it does not consume
 * comment metadata, doc-comment attachments, or alternate AST shapes — so the
 * factory pins the same options that this module previously passed inline to
 * `new Parser.GMLParser(...)`. Forwarding these options to the canonical
 * adapter guarantees behaviour parity with the prior implementation.
 *
 * Prediction-cache release thresholds fall back to the parser workspace's
 * canonical defaults rather than re-declaring magic numbers here, keeping the
 * release cadence tunable in exactly one place.
 */
const REFACTOR_BRIDGE_PARSER_OPTIONS: Readonly<ParserOptions> = Object.freeze({
    ...defaultParserOptions
});

/**
 * Create the complete set of bridge adapters for the refactor engine.
 *
 * When no options are supplied, returns the canonical production bridges.
 * Callers can override individual bridges for testing or when a custom
 * adapter is required. The `projectRoot` option is only consulted when no
 * custom `semantic` bridge is supplied; passing a semantic bridge bypasses
 * project root plumbing entirely so the factory owns one consistent seam.
 *
 * @param options - Optional overrides for any bridge plus the project root
 *   forwarded to the default semantic bridge.
 */
export function createRefactorBridges(options: RefactorBridgesOptions = {}): RefactorBridges {
    const { formatter, parser, semantic, projectRoot } = options;
    return Object.freeze({
        formatter: formatter ?? new GmlTranspilerBridge(createCanonicalGmlTranspilerAdapter()),
        parser: parser ?? new GmlParserBridge(createCanonicalGmlParserAdapter(REFACTOR_BRIDGE_PARSER_OPTIONS)),
        semantic: semantic ?? new GmlSemanticBridge({}, projectRoot ?? process.cwd())
    });
}
