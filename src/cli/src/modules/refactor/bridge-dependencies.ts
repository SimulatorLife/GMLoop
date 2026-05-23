/**
 * Canonical factory for the concrete adapter instances used by GML refactor bridges.
 *
 * This module is the single place that instantiates concrete workspace adapters
 * (parser, transpiler) with their production configuration.  Keeping instantiation
 * here rather than inline in the bridge constructors means bridges can remain pure
 * adapters that only receive their dependencies, making them easier to unit-test
 * and swap in integration scenarios.
 *
 * Callers that need to inject alternate adapters (e.g., in tests) can do so through
 * the bridge constructor parameters; the factory functions here are only the
 * defaults for production use.
 */

import { Parser } from "@gmloop/parser";
import { Transpiler } from "@gmloop/transpiler";

import type { GmlTranspilerAdapter } from "./bridge-types.js";

/**
 * Create the canonical GML parser adapter for use by GmlParserBridge.
 *
 * Returns a parse function compatible with the Refactor.ParserBridge contract.
 */
function parseGml(source: string) {
    const gmlParser = new Parser.GMLParser(source, {
        getLocations: true,
        simplifyLocations: true
    });
    return gmlParser.parse();
}

export function createGmlParserAdapter(): (source: string) => unknown {
    return parseGml;
}

/**
 * Create the canonical GML transpiler adapter for use by GmlTranspilerBridge.
 *
 * Wrapped in a factory for symmetry with createGmlParserAdapter.  Callers who
 * need to inject a mock transpiler can pass it directly to the bridge constructor;
 * the factory is only the default production path.
 */
export function createGmlTranspilerAdapter(): GmlTranspilerAdapter {
    return new Transpiler.GmlTranspiler();
}

/**
 * Re-export shared bridge types from the canonical module for callers
 * that prefer to import everything from a single entry point.
 */
export type { GmlTranspilerAdapter } from "./bridge-types.js";
