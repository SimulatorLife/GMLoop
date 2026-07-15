/**
 * Canonical factory for the concrete adapter instances used by GML refactor bridges.
 *
 * This module is the single seam through which the refactor engine reaches the
 * parser and transpiler workspaces. It delegates to the CLI's existing adapter
 * factories in `src/cli/src/modules/transpilation/adapters.ts`, which already
 * own the dependency-inversion seam for `new Parser.GMLParser(...)` and
 * `new Transpiler.GmlTranspiler(...)`.
 *
 * Delegating here keeps two consequences in lockstep:
 *   1. The refactor bridges stop reaching directly into `@gmloop/parser` and
 *      `@gmloop/transpiler`, eliminating a parallel concrete-instantiation path
 *      that had drifted away from the canonical adapter options.
 *   2. The refactor bridge configuration is pinned to a single named constant,
 *      so any future change to parser/transpiler wiring only needs to happen in
 *      one place — the canonical adapter module — and is automatically picked
 *      up by every refactor consumer.
 *
 * Callers that need to inject alternate adapters (e.g., in tests) can do so
 * through the bridge constructor parameters; the factory functions here are
 * only the defaults for production use.
 */

import {
    createGmlParserAdapter as createCanonicalGmlParserAdapter,
    createGmlTranspilerAdapter as createCanonicalGmlTranspilerAdapter
} from "../transpilation/adapters.js";
import type { GmlTranspilerAdapter } from "./bridge-types.js";

/**
 * Parser configuration consumed by the refactor bridge factories.
 *
 * The refactor engine only needs source locations — it does not consume
 * comment metadata, doc-comment attachments, or alternate AST shapes — so the
 * factory pins the same options that this module previously passed inline to
 * `new Parser.GMLParser(...)`. Forwarding these options to the canonical
 * adapter guarantees behaviour parity with the prior implementation.
 */
const REFACTOR_BRIDGE_PARSER_OPTIONS = Object.freeze({
    getComments: true,
    getLocations: true,
    simplifyLocations: true,
    attachFunctionDocComments: true,
    sllPredictionMaxSourceLength: 8000,
    astFormat: "gml",
    asJSON: false
});

/**
 * Create the canonical GML parser adapter for use by GmlParserBridge.
 *
 * Returns a parse function compatible with the Refactor.ParserBridge contract.
 * Delegates to the CLI's canonical parser-adapter factory so the bridge layer
 * never instantiates the concrete `Parser.GMLParser` class directly.
 */
export function createGmlParserAdapter(): (source: string) => unknown {
    return createCanonicalGmlParserAdapter(REFACTOR_BRIDGE_PARSER_OPTIONS);
}

/**
 * Create the canonical GML transpiler adapter for use by GmlTranspilerBridge.
 *
 * Wrapped in a factory for symmetry with createGmlParserAdapter. Callers who
 * need to inject a mock transpiler can pass it directly to the bridge
 * constructor; the factory is only the default production path. Delegates to
 * the CLI's canonical transpiler-adapter factory so the bridge layer never
 * instantiates the concrete `Transpiler.GmlTranspiler` class directly.
 */
export function createGmlTranspilerAdapter(): GmlTranspilerAdapter {
    return createCanonicalGmlTranspilerAdapter();
}

/**
 * Re-export shared bridge types from the canonical module for callers
 * that prefer to import everything from a single entry point.
 */
export type { GmlTranspilerAdapter } from "./bridge-types.js";
