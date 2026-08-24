import type { CallTargetAnalyzer, EmitOptions, GmlNode, IdentifierAnalyzer } from "./ast.js";
import { GmlToJsEmitter as GmlToJsEmitterImplementation } from "./emitter.js";
import { createSemanticOracle as createSemanticOracleImplementation } from "./semantic-factory.js";

type StatementLike = GmlNode | undefined | null;
type SemanticInput = IdentifierAnalyzer & CallTargetAnalyzer;

/**
 * Emit JavaScript from a GML AST using the transpiler emitter.
 *
 * @param ast - AST node to emit.
 * @param sem - Optional semantic oracle/analyzers for identifier and call analysis.
 * @param options - Optional emitter options to override defaults.
 * @returns JavaScript code for the AST.
 */
export function emitJavaScript(ast: StatementLike, sem?: SemanticInput, options: Partial<EmitOptions> = {}): string {
    const oracle = sem ?? createSemanticOracleImplementation();
    const emitter = new GmlToJsEmitterImplementation(oracle, options);
    return emitter.emit(ast);
}

export type * from "./ast.js";
export { emitBuiltinFunction, isBuiltinFunction } from "./builtins.js";
export { wrapConditional, wrapConditionalBody, wrapRawBody } from "./code-wrapping.js";
export { tryFoldConstantExpression } from "./constant-folding.js";
export { GmlToJsEmitter } from "./emitter.js";
export { lowerEnumDeclaration } from "./enum-lowering.js";
export { escapeTemplateText, isIdentifierLike, normalizeStructKeyText, stringifyStructKey } from "./js-string-utils.js";
export { normalizeGmlNumericLiteral } from "./literal-normalization.js";
export {
    collectGlobalVarNames,
    collectLocalVariables,
    collectStaticVariableDeclarations
} from "./local-variable-collector.js";
export { mapBinaryOperator } from "./operator-mapping.js";
export type { SemanticOracleOptions } from "./semantic-factory.js";
export { createSemanticOracle } from "./semantic-factory.js";
export { ensureStatementTerminated, isStatementTerminated } from "./statement-termination-policy.js";
export { StringBuilder } from "./string-builder.js";
export * from "./type-guards.js";
export { lowerWithStatement } from "./with-lowering.js";
