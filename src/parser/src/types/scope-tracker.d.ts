import type { MutableGameMakerAstNode } from "@gmloop/core";
/**
 * Global identifier tracking.
 *
 * Provides the ability to mark and apply global identifiers without
 * coupling to role management or scope lifecycle operations.
 */
export interface GlobalIdentifierTracker {
    markGlobalIdentifier(node: MutableGameMakerAstNode | null | undefined): void;
    applyGlobalIdentifiersToNode(node: MutableGameMakerAstNode | null | undefined): void;
    globalIdentifiers?: Set<unknown> | null;
}
/**
 * Identifier role context control.
 *
 * Provides role-stack lifecycle operations without coupling to role
 * annotation application.
 */
export interface IdentifierRoleContextController {
    /**
     * Execute a callback within an identifier role context.
     *
     * Pushes the provided role onto an internal stack, executes the callback,
     * and then pops the role. The role object typically contains:
     * - `type`: "declaration" or "reference"
     * - `kind`: Semantic kind (e.g., "variable", "function", "parameter")
     * - `tags`: Additional classification tags
     * - `scopeOverride`: Optional scope override for cross-scope declarations
     *
     * @param role Role descriptor object to apply during callback execution
     * @param callback Function to execute with the role active
     * @returns The result of the callback function
     */
    withRole?<T>(role: object | null, callback: () => T): T;
    /**
     * Create a deep copy of an identifier role object.
     *
     * @param role Role object to clone
     * @returns Cloned role with independent arrays and nested objects
     */
    cloneRole(role: object | null): object | null;
}
/**
 * Identifier role application.
 *
 * Provides role annotation behavior for identifier nodes without coupling
 * to role-stack lifecycle management.
 */
export interface IdentifierRoleApplicator {
    /**
     * Apply the current active role to an identifier node.
     *
     * Annotates the node with metadata from the role stack, including
     * classification tags and scope information. This enables downstream
     * semantic analysis and code generation.
     *
     * @param name Identifier name being annotated
     * @param node AST node to receive role metadata
     */
    applyCurrentRoleToIdentifier(name: string | null | undefined, node: MutableGameMakerAstNode | null | undefined): void;
}
/**
 * Complete identifier role manager interface.
 *
 * Combines role context and role application contracts for consumers that
 * require both capabilities.
 */
export interface IdentifierRoleManager extends IdentifierRoleContextController, IdentifierRoleApplicator {
}
/**
 * Scope lifecycle management.
 *
 * Provides the ability to manage scope boundaries during parsing
 * without coupling to identifier tracking or role management.
 */
export interface ScopeLifecycle {
    /**
     * Execute a callback within a new scope context.
     *
     * Creates a new scope with the specified kind, executes the callback,
     * and then exits the scope. Scopes form a stack during parsing, with
     * each scope tracking its own declarations and references.
     *
     * Common scope kinds include:
     * - "program" - Root scope for the entire file
     * - "function" - Function body scope
     * - "block" - Statement block scope
     * - "with" - GameMaker's `with` statement scope
     *
     * @param kind Semantic kind of scope being entered
     * @param callback Function to execute within the new scope
     * @returns The result of the callback function
     */
    withScope?<T>(kind: string, callback: () => T): T;
}
/**
 * Complete scope tracker interface.
 *
 * Combines all scope-related interfaces for consumers that need full
 * scope tracking capabilities. This interface serves as the contract
 * between parser and semantic analysis packages.
 *
 * The parser defines what operations it needs from a scope tracker,
 * while the semantic package provides concrete implementations. This
 * dependency inversion pattern breaks circular dependencies and allows
 * both packages to evolve independently.
 *
 * Consumers should prefer depending on the minimal interface they need
 * (GlobalIdentifierTracker, IdentifierRoleContextController, IdentifierRoleApplicator, ScopeLifecycle) rather
 * than this composite interface when possible.
 */
export interface ScopeTracker extends GlobalIdentifierTracker, IdentifierRoleManager, ScopeLifecycle {
}
/**
 * Options for configuring scope tracking during parsing.
 *
 * These options control whether scope tracking is enabled and how
 * the scope tracker instance is created. The factory pattern allows
 * the parser to remain decoupled from specific scope tracker implementations.
 */
export type ScopeTrackerOptions = {
    /**
     * Whether scope tracking is enabled.
     *
     * When false, the parser skips all scope-related operations and
     * produces a simpler AST without identifier metadata.
     */
    enabled: boolean;
    /**
     * Factory function for creating scope tracker instances.
     *
     * This dependency injection pattern allows semantic analysis packages
     * to provide their own scope tracker implementations without the parser
     * needing to import them directly.
     *
     * @returns A scope tracker instance, or null to disable tracking
     */
    createScopeTracker?: () => ScopeTracker | null;
    /**
     * Whether to collect identifier metadata during parsing.
     *
     * When true, the parser annotates identifier nodes with role and
     * scope information that can be used for semantic analysis.
     */
    getIdentifierMetadata?: boolean;
    /**
     * Additional options for specific scope tracker implementations.
     */
    [key: string]: unknown;
};
//# sourceMappingURL=scope-tracker.d.ts.map