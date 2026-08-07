/**
 * Dependency-inversion seam for the GML parser used by the refactor
 * workspace's high-level codemods.
 *
 * Codemods previously called `Parser.GMLParser.parse(sourceText)` directly.
 * That coupling forced every transformation to know the concrete parser
 * class, made it impossible to swap parsers in tests without monkey-patching
 * the workspace exports, and scattered parser option configuration across
 * seven different codemod files.
 *
 * The factory exposed here wraps that `new`-style invocation in a single
 * contract so the refactor engine, the CLI bridge layer, and individual
 * codemods depend only on the abstraction. Callers that need an alternate
 * parser (tests, embedders, instrumentation) can call
 * {@link createDefaultGmlProgramParser} with custom options to obtain a
 * configured adapter, mirroring the pattern established by
 * `src/cli/src/modules/transpilation/adapters.ts` and
 * `src/cli/src/modules/refactor/bridge-dependencies.ts`.
 *
 * (target-state.md §2.2 — abstraction boundaries over concrete adapter
 * classes; §3.2 — formatter/linter/refactor stays decoupled from concrete
 * low-level adapters.)
 */

import { Parser, type ParserOptions } from "@gmloop/parser";

/**
 * Functional contract for parsing GML source text into an AST program node.
 *
 * Returning the AST directly keeps the contract minimal and avoids leaking
 * `GMLParser` shape into the codemods that import this module.
 */
export type GmlProgramParser = (sourceText: string) => unknown;

/**
 * Shape of the factory that produces a parser adapter.
 *
 * Exposing the factory as a first-class callable lets the refactor engine
 * accept a parser factory as part of its own dependency surface and lets
 * future codemods customize options (for example, to enable doc comments)
 * without reaching back into the parser workspace.
 */
export type GmlProgramParserFactory = (options?: Readonly<ParserOptions>) => GmlProgramParser;

/**
 * Default parser options shared by every codemod parsing path.
 *
 * Codemods need source locations (for offset-based edit generation) and the
 * comment metadata attached by default. Keeping these options centralized
 * guarantees that every codemod parses identically and that future tuning
 * (for example, switching the AST format) only happens here.
 */
export const DEFAULT_CODEMOD_PARSER_OPTIONS: Readonly<ParserOptions> = Object.freeze({
    astFormat: "gml",
    asJSON: false,
    getComments: true,
    getLocations: true,
    simplifyLocations: true,
    attachFunctionDocComments: true,
    sllPredictionMaxSourceLength: 8000
});

/**
 * Default factory producing a `GmlProgramParser` backed by the canonical
 * `Parser.GMLParser.parse` static entry point.
 *
 * The factory is the single place that knows how to assemble the concrete
 * parser instance, so codemods never have to call
 * `Parser.GMLParser.parse(...)` themselves. Overriding options is supported
 * so individual call sites that need a different configuration (for example,
 * a codemod that prefers `simplifyLocations: false` to preserve every
 * intermediate location) can opt in without losing the abstraction.
 */
export function createDefaultGmlProgramParser(options?: Readonly<ParserOptions>): GmlProgramParser {
    const resolvedOptions: Readonly<ParserOptions> = options ?? DEFAULT_CODEMOD_PARSER_OPTIONS;
    return (sourceText: string) => Parser.GMLParser.parse(sourceText, resolvedOptions);
}

/**
 * Canonical parser adapter used by every codemod in the refactor workspace.
 *
 * Codemods depend on this constant rather than calling
 * `Parser.GMLParser.parse` directly. Centralizing the adapter keeps the
 * parser options in sync across codemods and gives tests a single seam to
 * override (by re-creating the parser via {@link createDefaultGmlProgramParser}).
 */
export const defaultGmlProgramParser: GmlProgramParser = Object.freeze(createDefaultGmlProgramParser());
