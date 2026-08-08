/**
 * Shared adapter contracts for the GML refactor bridges.
 *
 * The bridge classes (`GmlParserBridge`, `GmlTranspilerBridge`) consume these
 * narrow contract types directly. They are intentionally defined in their
 * canonical form (a parse function, a transpiler surface) rather than as
 * factory-of-factory closures, so the bridges do not need to be re-wired when
 * a different adapter implementation is substituted.
 *
 * The factory that produces the *default* adapter for each bridge lives in
 * `bridge-factory.ts`, which is the only module that needs to import the
 * concrete `Parser` / `Transpiler` workspaces.
 */

/**
 * Functional contract for parsing a GML source string into an AST.
 *
 * Mirrors `GmlParserAdapter` from `../transpilation/adapters.ts` so the
 * refactor bridge can consume the canonical CLI adapter directly without
 * another layer of wrapping.
 */
export type GmlParserAdapter = (source: string) => unknown;

/**
 * Shape of the transpiler adapter consumed by `GmlTranspilerBridge`.
 *
 * Keeping this narrow avoids coupling the bridge to the full
 * `Transpiler.GmlTranspiler` surface and lets callers inject test doubles
 * with minimal ceremony.
 */
export type GmlTranspilerAdapter = {
    transpileScript(request: { sourceText: string; symbolId: string }): unknown;
};
