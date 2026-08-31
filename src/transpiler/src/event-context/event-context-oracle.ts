/**
 * Event-context oracle for GML object event transpilation.
 *
 * In GML, object events are plain statement sequences that execute in the context
 * of a specific object instance. Identifier resolution follows these rules:
 *
 *   1. Identifiers declared with `var` in the event body → local variables
 *   2. Built-in functions (abs, sqrt, etc.) → pass through as bare names
 *   3. Known scripts → routed through the hot-reload runtime wrapper
 *   4. Explicit `global.` access or `globalvar` → global fields
 *   5. All other identifiers → instance fields, emitted as `self.<name>`
 *
 * `EventContextOracle` wraps a base oracle that handles rules 2–4 and applies
 * rule 1 and 5 on top, enabling correct transpilation of event code without
 * requiring full project-level scope analysis.
 *
 * The oracle also tracks nested lexical scopes so that identifiers declared as
 * function parameters, `var`/`static` bindings inside nested function bodies,
 * and catch-clause parameters stay as bare locals (rule 1) instead of leaking
 * out to instance fields (rule 5). The emitter pushes a scope when entering
 * a function/constructor/catch and pops it on exit.
 */

import type {
    CallExpressionNode,
    CallTargetAnalyzer,
    IdentifierAnalyzer,
    IdentifierMetadata,
    IdentifierNode,
    LexicalScopeController,
    SemKind
} from "../emitter/ast.js";
/**
 * SemKind values that the delegate oracle has definitively classified.
 * These take precedence over the event-context fallback to `self_field`.
 */
const DELEGATE_OWNED_KINDS: ReadonlySet<SemKind> = new Set<SemKind>([
    "builtin",
    "script",
    "global_field",
    "other_field"
]);

/**
 * An oracle that classifies identifiers for GML object event transpilation.
 *
 * It wraps a base oracle and adds event-specific semantics:
 * - Var-declared locals in the event body are kept as `local`
 * - All other unknown identifiers are treated as `self_field` (instance vars)
 * - Builtins, scripts, globals, and other-refs delegate to the base oracle
 *
 * This class is designed for single-event transpilation. Instantiate one
 * `EventContextOracle` per event, passing in the pre-collected local variable
 * set from `collectLocalVariables()`.
 *
 * @example
 * ```typescript
 * const baseOracle = createSemanticOracle({ scriptNames });
 * const localVars = collectLocalVariables(ast);
 * const oracle = new EventContextOracle(baseOracle, localVars);
 * const emitter = new GmlToJsEmitter(oracle, {}, oracle);
 * // Identifiers like `health` → `self.health`
 * // Identifiers like `var speed` → `speed` (local)
 * // Built-ins like `abs` → `abs`
 * ```
 */
export class EventContextOracle implements IdentifierAnalyzer, CallTargetAnalyzer, LexicalScopeController {
    private readonly delegate: IdentifierAnalyzer & CallTargetAnalyzer;
    private readonly scopeStack: Array<ReadonlySet<string>>;

    /**
     * @param delegate - The base oracle to delegate builtin/script/global checks to
     * @param localVars - The set of var-declared variable names in this event body
     */
    constructor(delegate: IdentifierAnalyzer & CallTargetAnalyzer, localVars: ReadonlySet<string>) {
        this.delegate = delegate;
        // The outer scope is seeded with the event-body locals collected up-front.
        // Nested scopes (function bodies, catch clauses) are pushed on demand.
        this.scopeStack = [localVars];
    }

    /**
     * Classify an identifier for event-context code generation.
     *
     * Priority:
     * 1. Delegate-owned kinds (builtin, script, global_field, other_field) → pass through
     * 2. Names bound in any active scope (event body, nested functions, catch clauses) → `local`
     * 3. Everything else → `self_field`
     */
    kindOfIdent(node: IdentifierNode | IdentifierMetadata | null | undefined): SemKind {
        // Let the delegate classify builtins, scripts, globals, and other-refs first.
        const delegateKind = this.delegate.kindOfIdent(node);
        if (DELEGATE_OWNED_KINDS.has(delegateKind)) {
            return delegateKind;
        }

        const name = this.delegate.nameOfIdent(node);

        // Preserve var-declared locals (and parameters, catch bindings) as plain local variables.
        // Walk inner-most scope first so a nested function's own `var` shadows outer names.
        if (name) {
            for (let index = this.scopeStack.length - 1; index >= 0; index -= 1) {
                const scope = this.scopeStack[index];
                if (scope !== undefined && scope.has(name)) {
                    return "local";
                }
            }
        }

        // All other undeclared identifiers are instance fields in event context.
        return "self_field";
    }

    /**
     * Push the lexical names owned by a nested function, constructor, or catch clause.
     *
     * The emitter owns AST traversal and supplies the complete set of parameters and
     * `var`/`static` declarations for the new scope. Keeping traversal out of the oracle
     * preserves its single responsibility: classifying names against active scopes.
     *
     * @param localNames - Names that must resolve as lexical locals in the nested scope
     */
    pushScope(localNames: ReadonlySet<string>): void {
        this.scopeStack.push(localNames);
    }

    /**
     * Pop the most recently pushed lexical scope.
     *
     * Pairs with {@link pushScope}. Calling `popScope` when only the initial
     * event scope is on the stack is a programming error and throws — the
     * emitter must always push/pop in balanced pairs.
     */
    popScope(): void {
        if (this.scopeStack.length <= 1) {
            throw new Error("EventContextOracle.popScope called without a matching pushScope");
        }
        this.scopeStack.pop();
    }

    /** @inheritdoc */
    nameOfIdent(node: IdentifierNode | IdentifierMetadata | null | undefined): string {
        return this.delegate.nameOfIdent(node);
    }

    /** @inheritdoc */
    qualifiedSymbol(node: IdentifierNode | IdentifierMetadata | null | undefined): string | null {
        return this.delegate.qualifiedSymbol(node);
    }

    /** @inheritdoc */
    callTargetKind(node: CallExpressionNode): "script" | "builtin" | "unknown" {
        return this.delegate.callTargetKind(node);
    }

    /** @inheritdoc */
    callTargetSymbol(node: CallExpressionNode): string | null {
        return this.delegate.callTargetSymbol(node);
    }
}
