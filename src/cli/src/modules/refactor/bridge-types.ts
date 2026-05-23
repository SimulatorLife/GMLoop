/**
 * Shared type definitions for GML refactor bridges.
 *
 * These types are the canonical contracts between the bridge-adapter layer
 * (parser-bridge, transpiler-bridge) and the bridge-dependencies factory module.
 * Keeping them in one place avoids circular import issues when a type is needed
 * in both the bridge class and the factory that creates its default adapter.
 */

/**
 * Shape of the transpiler adapter used by GmlTranspilerBridge.
 * Keeping this narrow avoids coupling the bridge to the full Transpiler
 * workspace surface and lets callers inject test doubles with minimal ceremony.
 */
export type GmlTranspilerAdapter = {
    transpileScript(request: { sourceText: string; symbolId: string }): unknown;
};

/**
 * Factory type for creating a parser adapter function.
 * Accepts optional configuration and returns a parse function.
 */
export type ParserAdapterFactory = () => (source: string) => unknown;

/**
 * Factory type for creating a transpiler adapter.
 */
export type TranspilerAdapterFactory = () => GmlTranspilerAdapter;
