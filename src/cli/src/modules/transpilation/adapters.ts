/**
 * Dependency-inversion seam for the concrete parser and transpiler adapters
 * consumed by the CLI's high-level orchestration layers (watch, transpile,
 * graph commands, and the transpilation coordinator).
 *
 * Without this seam, the orchestration modules import `new Parser.GMLParser()`
 * and `new Transpiler.GmlTranspiler()` directly. That couples the CLI to two
 * concrete workspace classes, which makes it impossible to:
 *
 *   - Substitute the parser/transpiler in tests without monkey-patching the
 *     workspace exports.
 *   - Compose alternative implementations (e.g., a parser preprocessor or a
 *     transpiler wrapper that instruments patch payloads).
 *   - Audit a single place that defines the canonical production
 *     configuration for these adapters.
 *
 * The factory functions here wrap those `new` calls in a seam that orchestration
 * code can depend on. Tests and embedders can pass custom factory overrides
 * to the higher-level helpers (see `createGmlParserAdapter` / `createGmlTranspilerAdapter`)
 * to inject test doubles, mirroring the pattern established by
 * `src/cli/src/modules/refactor/bridge-factory.ts`.
 *
 * (target-state.md §2.1 — workspace public APIs; §2.2 — abstraction boundaries
 * over concrete adapter classes.)
 */

import { Parser, type ParserOptions } from "@gmloop/parser";
import { Transpiler, type TranspilerDependencies } from "@gmloop/transpiler";

/**
 * Concrete transpiler instance shape produced by the canonical factory.
 *
 * Inferred from the `Transpiler.GmlTranspiler` constructor so the factory's
 * return type stays in sync with the transpiler workspace's public class.
 * Re-exporting it as a named type keeps the coordinator's `RuntimeTranspiler`
 * alias readable without forcing every consumer to spell out
 * `InstanceType<typeof Transpiler.GmlTranspiler>`.
 */
export type GmlTranspilerInstance = InstanceType<typeof Transpiler.GmlTranspiler>;

/**
 * Functional contract for parsing a GML source string into an AST.
 *
 * The high-level orchestration layer (e.g. `coordinator.ts`,
 * `commands/watch.ts`) only ever needs to ask "parse this string, give me the
 * AST", so the seam is intentionally a function. Returning the AST directly
 * keeps the contract minimal and avoids leaking `GMLParser` shape into the
 * call sites that import this module.
 */
export type GmlParserAdapter = (source: string) => unknown;

/**
 * Default parser options used by the canonical adapter.
 *
 * The CLI command pipeline is strictly layout- and dependency-focused: it
 * needs source locations for accurate dependency extraction but does not
 * require comments to be attached to AST nodes (the formatter is the
 * workspace that consumes comment metadata, and the CLI commands operate
 * downstream of the formatter). The values match the
 * {@link Parser.GMLParser} defaults that the rest of the CLI's hot-reload
 * pipeline already uses, so swapping to this factory does not change
 * behaviour for any existing call site.
 */
export const DEFAULT_PARSER_ADAPTER_OPTIONS: Readonly<ParserOptions> = Object.freeze({
    getComments: false,
    getLocations: true,
    simplifyLocations: true,
    attachFunctionDocComments: false,
    sllPredictionMaxSourceLength: 8000,
    astFormat: "gml",
    asJSON: false
});

/**
 * Shape of the factory that produces a parser adapter.
 *
 * Exposing the factory as a first-class callable lets the coordinator and
 * other high-level modules accept a parser factory as part of their own
 * dependency surface. Tests can pass a stub that returns pre-baked ASTs
 * without having to mock the `Parser` workspace module.
 */
export type GmlParserAdapterFactory = (options?: Readonly<ParserOptions>) => GmlParserAdapter;

/**
 * Default factory: instantiates the canonical `Parser.GMLParser` with the
 * CLI's default option set and returns a closure that delegates to it.
 *
 * The factory is the single place that knows how to assemble the concrete
 * parser instance, so callers never have to write `new Parser.GMLParser(...)`
 * themselves. Overriding options is supported so individual call sites that
 * need a different configuration (for example, a command that does want
 * comments attached) can opt in without losing the abstraction.
 */
export const createGmlParserAdapter: GmlParserAdapterFactory = (options) => {
    const resolvedOptions: Readonly<ParserOptions> = options ?? DEFAULT_PARSER_ADAPTER_OPTIONS;
    return (source: string) => {
        const parser = new Parser.GMLParser(source, resolvedOptions);
        return parser.parse();
    };
};

/**
 * Transpiler factory shape.
 *
 * The transpiler surface is more than a single function call (it exposes
 * `transpileScript`, `transpileEvent`, `transpileExpression`, etc.), so the
 * seam returns the concrete `GmlTranspiler` instance. Callers that want a
 * narrower surface can wrap the returned instance; the abstraction is
 * intentionally the boundary, not the implementation contract.
 */
export type GmlTranspilerAdapterFactory = (dependencies?: Readonly<TranspilerDependencies>) => GmlTranspilerInstance;

/**
 * Default factory: instantiates the canonical `Transpiler.GmlTranspiler`.
 *
 * Mirrors the `createGmlParserAdapter` shape: callers depend on this factory
 * instead of the workspace class, so the same command module can be reused
 * in tests with a stub factory and in production with the real
 * implementation. The factory is parameterised by the upstream dependencies
 * (semantic analyzer, emitter options) so a test fixture can swap in a
 * minimal analyzer without recreating the entire transpiler class.
 */
export const createGmlTranspilerAdapter: GmlTranspilerAdapterFactory = (dependencies) => {
    return new Transpiler.GmlTranspiler(dependencies);
};
