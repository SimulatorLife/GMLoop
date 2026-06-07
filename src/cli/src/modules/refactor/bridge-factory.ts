/**
 * Factory module for refactor engine bridge adapters.
 *
 * Produces the parser, transpiler, and semantic bridge instances used by the
 * refactor engine.  Centralizing instantiation here keeps call-sites (CLI
 * commands, test helpers) free of direct `new` expressions on concrete adapter
 * classes, making it straightforward to swap or stub the bridges when needed.
 *
 * Consumers that only need the default bridges can call {@link createRefactorBridges}
 * with no arguments.  Callers that need to inject test doubles or custom adapters
 * can pass them as options instead.
 */

import type { PartialSemanticAnalyzer } from "@gmloop/refactor";
import type * as Refactor from "@gmloop/refactor";

import { createGmlParserAdapter, createGmlTranspilerAdapter } from "./bridge-dependencies.js";
import type { ParserAdapterFactory, TranspilerAdapterFactory } from "./bridge-types.js";
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
    // Canonical factory functions that instantiate the concrete parser and
    // transpiler adapters with their production configuration.  These factories
    // live here rather than inside the bridge constructors so the bridges
    // remain pure adapters that only receive their dependencies.
    const defaultParserFactory: ParserAdapterFactory = createGmlParserAdapter;
    const defaultTranspilerFactory: TranspilerAdapterFactory = createGmlTranspilerAdapter;

    return Object.freeze({
        formatter: options.formatter ?? new GmlTranspilerBridge(defaultTranspilerFactory),
        parser: options.parser ?? new GmlParserBridge(defaultParserFactory),
        semantic: options.semantic ?? new GmlSemanticBridge({}, projectRoot ?? process.cwd())
    });
}
