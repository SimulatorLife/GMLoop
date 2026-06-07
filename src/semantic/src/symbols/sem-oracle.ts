import type { ScopeTracker } from "../scopes/scope-tracker.js";
import { buildCallTargetSymbol, buildQualifiedSymbol } from "./symbol-building.js";

/**
 * Type guard to check if a value is an identifier metadata object.
 */
function isIdentifierMetadata(value: unknown): value is { name: string; isGlobalIdentifier?: boolean } {
    return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}

/**
 * Extract classifications array from a declaration object safely.
 */
function getClassifications(declaration: unknown): string[] | undefined {
    if (typeof declaration !== "object" || declaration === null) {
        return undefined;
    }

    const classifications = (declaration as Record<string, unknown>).classifications;

    if (!Array.isArray(classifications)) {
        return undefined;
    }

    return classifications as string[];
}

/**
 * Semantic kind classification for identifiers, matching the transpiler's
 * expected vocabulary for code generation.
 */
export type SemKind = "local" | "self_field" | "other_field" | "global_field" | "builtin" | "script";

/**
 * Minimal identifier metadata required for semantic analysis.
 */
export interface IdentifierMetadata {
    readonly name: string;
    readonly isGlobalIdentifier?: boolean;
}

/**
 * Call expression node structure expected by semantic oracle methods.
 */
export interface CallExpressionNode {
    readonly type: "CallExpression";
    readonly object: unknown;
}

/**
 * Analyzes identifiers to determine their semantic kind, name, and qualified
 * symbol. Used by the transpiler to generate correct variable references
 * (local vs global vs field access).
 */
export interface IdentifierAnalyzer {
    kindOfIdent(node: IdentifierMetadata | null | undefined): SemKind;
    nameOfIdent(node: IdentifierMetadata | null | undefined): string;
    qualifiedSymbol(node: IdentifierMetadata | null | undefined): string | null;
}

/**
 * Analyzes call expression targets to classify them as scripts, built-ins,
 * or unknown callables. Used by the transpiler to route script calls through
 * the runtime wrapper and handle built-in functions specially.
 */
export interface CallTargetAnalyzer {
    callTargetKind(node: CallExpressionNode): "script" | "builtin" | "unknown";
    callTargetSymbol(node: CallExpressionNode): string | null;
}

/**
 * Default set of scope kinds that represent an object instance (self) context.
 * Identifiers that cannot be resolved as locals, builtins, or scripts inside
 * one of these scopes are classified as `self_field` so the transpiler can
 * emit `self.<name>` instead of a bare identifier.
 */
const DEFAULT_SELF_CONTEXT_SCOPE_KINDS: ReadonlySet<string> = new Set(["object_event", "object_body"]);

/**
 * Basic semantic oracle implementation that bridges the scope tracker and
 * transpiler. Provides identifier classification and symbol resolution using
 * scope chain lookups without requiring full project analysis.
 *
 * This implementation prioritizes correctness over performance—it queries the
 * scope tracker for each identifier rather than caching results. Future
 * optimizations can add memoization if profiling indicates bottlenecks.
 *
 * Implements both IdentifierAnalyzer and CallTargetAnalyzer interfaces to
 * support clients that need both capabilities. Clients should depend on the
 * specific interface(s) they need rather than requiring both.
 */
export class BasicSemanticOracle implements IdentifierAnalyzer, CallTargetAnalyzer {
    private readonly tracker: ScopeTracker | null;
    private readonly builtinNames: Set<string>;
    private readonly scriptNames: Set<string>;
    private readonly selfContextScopeKinds: ReadonlySet<string>;

    /**
     * @param tracker Optional scope tracker instance. If null, falls back to
     *                sensible defaults without scope resolution.
     * @param builtinNames Set of built-in function names for call target
     *                     classification. Defaults to empty set.
     * @param scriptNames Set of known script names for script classification
     *                    and SCIP symbol generation. Defaults to empty set.
     * @param selfContextScopeKinds Set of scope kinds that indicate an object
     *                              instance (self) context. When an identifier
     *                              cannot be resolved in the scope chain and the
     *                              current scope stack contains one of these
     *                              kinds, the identifier is classified as
     *                              `self_field`. Defaults to
     *                              `{"object_event", "object_body"}`.
     */
    constructor(
        tracker: ScopeTracker | null = null,
        builtinNames: Set<string> = new Set(),
        scriptNames: Set<string> = new Set(),
        selfContextScopeKinds: ReadonlySet<string> = DEFAULT_SELF_CONTEXT_SCOPE_KINDS
    ) {
        this.tracker = tracker;
        this.builtinNames = builtinNames;
        this.scriptNames = scriptNames;
        this.selfContextScopeKinds = selfContextScopeKinds;
    }

    /**
     * Returns true when the current scope stack contains at least one scope
     * whose kind is listed in `selfContextScopeKinds`. This indicates that
     * unresolved identifiers should be treated as instance (self) fields.
     */
    private isInSelfContext(): boolean {
        if (!this.tracker) {
            return false;
        }
        const stack = this.tracker.getScopeStack();
        for (let i = stack.length - 1; i >= 0; i--) {
            if (this.selfContextScopeKinds.has(stack[i].kind)) {
                return true;
            }
        }
        return false;
    }

    private resolveKnownNameKind(name: string): "builtin" | "script" | null {
        if (this.builtinNames.has(name)) {
            return "builtin";
        }

        if (this.scriptNames.has(name)) {
            return "script";
        }

        return null;
    }

    /**
     * Classify an identifier based on its scope resolution and metadata.
     * Returns the semantic kind that drives transpiler code generation.
     *
     * Classification priority:
     * 1. Global identifiers (explicit `global.` or marked as global)
     * 2. Built-in functions (matched against known builtin set)
     * 3. Script names (matched against provided script set)
     * 4. Locally declared variables (resolved in scope chain)
     * 5. Unresolved identifiers inside an object-event scope → `self_field`
     * 6. Default to "local" for all other unresolved identifiers
     *
     * Step 5 handles the common GML pattern where an object event accesses an
     * instance variable by bare name (e.g., `hp -= 1` inside `Step_0`). Because
     * these variables are never declared as locals, the scope-chain lookup fails
     * and the oracle falls back to `self_field`, directing the transpiler to emit
     * `self.hp -= 1` instead of a bare `hp -= 1`.
     *
     * Note: `other_field` classification is not yet implemented. Access through
     * the `other` keyword is syntactically represented as a member expression
     * (`other.x`) by the parser, so the transpiler can handle it structurally
     * without oracle involvement.
     */
    kindOfIdent(node: IdentifierMetadata | null | undefined): SemKind {
        if (!node?.name) {
            return "local";
        }

        if (node.isGlobalIdentifier) {
            return "global_field";
        }

        const knownKind = this.resolveKnownNameKind(node.name);
        if (knownKind) {
            return knownKind;
        }

        if (this.tracker) {
            const declaration = this.tracker.resolveIdentifier(node.name);
            if (declaration) {
                const classifications = getClassifications(declaration);
                if (classifications?.includes("global")) {
                    return "global_field";
                }
                return "local";
            }

            // Identifier not declared in the local scope chain. If we are inside
            // an object-event scope, treat it as an instance (self) field so the
            // transpiler emits `self.<name>` rather than a bare identifier.
            if (this.isInSelfContext()) {
                return "self_field";
            }
        }

        return "local";
    }

    /**
     * Extract the identifier name from a node. Returns empty string if the
     * node is null or lacks a name property.
     */
    nameOfIdent(node: IdentifierMetadata | null | undefined): string {
        return node?.name ?? "";
    }

    /**
     * Generate a qualified SCIP-style symbol identifier for cross-reference
     * tracking and hot reload coordination.
     *
     * Returns SCIP symbols in the format:
     * - Scripts: "gml/script/{name}"
     * - Global variables: "gml/var/global::{name}"
     * - Built-ins: "gml/builtin/{name}"
     * - null for local variables (they don't need project-wide tracking)
     *
     * This enables hot reload pipelines to track dependencies and coordinate
     * invalidation when symbols change.
     */
    qualifiedSymbol(node: IdentifierMetadata | null | undefined): string | null {
        if (!node?.name) {
            return null;
        }

        const kind = this.kindOfIdent(node);
        return buildQualifiedSymbol(kind, node.name);
    }

    /**
     * Determine the kind of a call target (script, builtin, or unknown).
     * Uses the builtin and script name sets to classify known functions.
     *
     * Classification enables the transpiler to:
     * - Route script calls through the hot reload wrapper
     * - Handle built-in functions with native shims
     * - Defer unknown calls to runtime resolution
     */
    callTargetKind(node: CallExpressionNode): "script" | "builtin" | "unknown" {
        if (!isIdentifierMetadata(node.object)) {
            return "unknown";
        }

        const knownKind = this.resolveKnownNameKind(node.object.name);
        if (knownKind) {
            return knownKind;
        }

        return "unknown";
    }

    /**
     * Return a qualified SCIP-style symbol for the call target to enable
     * hot reload dependency tracking.
     *
     * Returns:
     * - Scripts: "gml/script/{name}"
     * - Built-ins: "gml/macro/{name}" (treated as macros for SCIP)
     * - null for unknown call targets
     */
    callTargetSymbol(node: CallExpressionNode): string | null {
        if (!isIdentifierMetadata(node.object)) {
            return null;
        }

        const kind = this.resolveKnownNameKind(node.object.name);
        if (!kind) {
            return null;
        }

        return buildCallTargetSymbol(kind, node.object.name);
    }
}
