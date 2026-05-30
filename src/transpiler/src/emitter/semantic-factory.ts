import { Core } from "@gmloop/core";
import { Semantic } from "@gmloop/semantic";

import type {
    CallExpressionNode,
    CallTargetAnalyzer,
    IdentifierAnalyzer,
    IdentifierMetadata,
    IdentifierNode,
    SemKind
} from "./ast.js";

/**
 * Configuration options for creating a semantic oracle for the transpiler.
 */
export interface SemanticOracleOptions {
    /**
     * Set of built-in function names. If not provided, loads from GameMaker
     * manual metadata via Core.loadManualFunctionNames().
     */
    readonly builtinNames?: Set<string>;

    /**
     * Set of known script names for script call classification.
     * Defaults to empty set if not provided.
     */
    readonly scriptNames?: Set<string>;
}

/**
 * Check whether an arbitrary GML AST node carries identifier metadata
 * (i.e. a `.name` string property, with an optional `.isGlobalIdentifier` flag).
 *
 * Used by call-target methods when inspecting the `object` child of a
 * CallExpression, which may be any GML node type at runtime.
 */
function hasIdentifierMetadata(value: unknown): value is IdentifierMetadata {
    return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}

/**
 * Scope-free semantic oracle for the transpiler.
 *
 * Classifies GML identifiers and call targets using only two lookup sets:
 * - `builtinNames`: GameMaker built-in function names (from manual metadata)
 * - `scriptNames`: known user script names (for hot-reload routing)
 *
 * No scope-chain resolution is performed; identifiers that are not builtins
 * or scripts fall back to "local". Scope-aware classification (e.g. detecting
 * instance fields vs local variables) is intentionally out of scope for the
 * transpiler layer. When scope tracking is needed in the future the caller
 * should wrap this oracle with a scope-aware decorator or supply a richer
 * `IdentifierAnalyzer` implementation via `GmlTranspiler`'s dependencies.
 *
 * Implements both `IdentifierAnalyzer` and `CallTargetAnalyzer` so it can be
 * passed directly to `GmlToJsEmitter`.
 */
class DefaultSemanticOracle implements IdentifierAnalyzer, CallTargetAnalyzer {
    private readonly builtinNames: Set<string>;
    private readonly scriptNames: Set<string>;

    constructor(builtinNames: Set<string>, scriptNames: Set<string>) {
        this.builtinNames = builtinNames;
        this.scriptNames = scriptNames;
    }

    private classifyName(name: string): "builtin" | "script" | null {
        if (this.builtinNames.has(name)) return "builtin";
        if (this.scriptNames.has(name)) return "script";
        return null;
    }

    kindOfIdent(node: IdentifierNode | IdentifierMetadata | null | undefined): SemKind {
        if (!node?.name) return "local";
        if (node.isGlobalIdentifier) return "global_field";
        return this.classifyName(node.name) ?? "local";
    }

    nameOfIdent(node: IdentifierNode | IdentifierMetadata | null | undefined): string {
        return node?.name ?? "";
    }

    qualifiedSymbol(node: IdentifierNode | IdentifierMetadata | null | undefined): string | null {
        if (!node?.name) return null;
        const kind = this.kindOfIdent(node);
        return Semantic.buildQualifiedSymbol(kind, node.name);
    }

    callTargetKind(node: CallExpressionNode): "script" | "builtin" | "unknown" {
        if (!hasIdentifierMetadata(node.object)) return "unknown";
        return this.classifyName(node.object.name) ?? "unknown";
    }

    callTargetSymbol(node: CallExpressionNode): string | null {
        if (!hasIdentifierMetadata(node.object)) return null;
        const kind = this.classifyName(node.object.name);
        if (!kind) return null;
        return Semantic.buildCallTargetSymbol(kind, node.object.name);
    }
}

/**
 * Create a semantic oracle configured for transpiler use.
 *
 * Returns a `DefaultSemanticOracle` that:
 * - Knows all GameMaker built-in functions from manual metadata
 * - Can classify user scripts when provided with script names
 *
 * The returned oracle implements both `IdentifierAnalyzer` and `CallTargetAnalyzer`
 * as expected by `GmlToJsEmitter`.
 *
 * @param options Configuration for the oracle
 * @returns An oracle instance that can classify identifiers and call targets
 *
 * @example
 * ```typescript
 * // Basic usage — loads built-in names automatically
 * const oracle = createSemanticOracle();
 * const emitter = new GmlToJsEmitter(oracle);
 *
 * // With script names for hot-reload routing
 * const oracle = createSemanticOracle({
 *   scriptNames: new Set(['scr_player_move', 'scr_enemy_ai'])
 * });
 * const emitter = new GmlToJsEmitter(oracle);
 * ```
 */
export function createSemanticOracle(options: SemanticOracleOptions = {}): IdentifierAnalyzer & CallTargetAnalyzer {
    const builtinNames = options.builtinNames ?? Core.loadManualFunctionNames();
    const scriptNames = options.scriptNames ?? new Set<string>();
    return new DefaultSemanticOracle(builtinNames, scriptNames);
}
