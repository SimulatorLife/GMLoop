/**
 * Minimal AST type declarations that get shared across packages without
 * introducing circular runtime dependencies. These interfaces only describe
 * the portions of the parser AST that the semantic layer consumes.
 */
export interface GameMakerAstLocation {
    /** One-based line number when available. */
    line?: number | null;
    /** Zero-based index when available (typically same as Character/Column). */
    index?: number | null;
    /** Optional column (human-friendly one-based column) for diagnostics. */
    column?: number | null;
}

export interface FeatherFixRange {
    /** Character offset where the fix range begins (inclusive). */
    start: number | null;
    /** Character offset where the fix range ends (exclusive). */
    end: number | null;
}

export interface FeatherFixDetail {
    id: string | null;
    title: string | null;
    description: string | null;
    correction: string | null;
    replacement?: string | null;
    target: string | null;
    range: FeatherFixRange | null;
    automatic: boolean;
}

export interface GameMakerAstNode {
    /** AST node kind (e.g., "Identifier", "Literal"). */
    type?: string | null;
    /** Location of the node’s start. Some transforms normalize the start to a numeric index. */
    start?: number | GameMakerAstLocation | null;
    /** Location of the node’s end. Some transforms normalize the end to a numeric index. */
    end?: number | GameMakerAstLocation | null;
    /** Source text captured alongside the node when available. */
    sourceText?: string | null;
    /** Directive token attached to `DefineStatement` nodes. */
    replacementDirective?: string | null;
    /** Attached comments or documentation metadata. */
    comments?: Array<GameMakerAstNode> | null;
    docComments?: Array<GameMakerAstNode> | null;
    /** Feathers fix metadata registered against the node. */
    _appliedFeatherDiagnostics?: Array<FeatherFixDetail> | null;
    /** Helper metadata preserved by consolidation utilities. */
    _structTrailingComments?: Array<unknown> | null;
    // deduped above
    _removedByConsolidation?: boolean;
    /** Optional boolean used by some transforms to indicate trailing inline comments */
    _hasTrailingInlineComment?: boolean;
    /** Optional marker used by annotate-static-overrides transform */
    _overridesStaticFunction?: boolean;
    /** Optional marker used by feather fixes to mark optional parameters */
    _featherOptionalParameter?: boolean;
    /** Original initializer captured by feather fixes */
    _featherOriginalInitializer?: string | null;
    _featherMaterializedTrailingUndefined?: boolean;
    /** Marker set when a trailing undefined value was materialized due to an explicit default on the left */
    _featherMaterializedFromExplicitLeft?: boolean;
    /** Internal flag used by transforms to avoid running multiple times on the same node */
    _hasProcessedArgumentCountDefaults?: boolean;
    /** Opt-in runtime metadata flags used by semantic modules */
    isGlobalIdentifier?: boolean;
    /** Scope identifier assigned by semantic scope tracker */
    scopeId?: string | null;
    /** Declaration metadata attached to identifier nodes */
    declaration?: GameMakerAstNode | null;
    /** Classification tags assigned by semantic passes (e.g., 'declaration', 'reference') */
    classifications?: Array<string> | null;
    /** Contained sub-node (eg. `foo.bar`). */
    object?: unknown;
    /** Contained sub-node (eg. `foo.bar`). */
    property?: unknown;
    /** Argument list attached to call/assign nodes. */
    arguments?: Array<unknown> | null;
    /** Single expression used by return or unary nodes. */
    argument?: GameMakerAstNode | null;
    /** Block node or statement list inside structured nodes. */
    body?: GameMakerAstNode | Array<unknown> | null;
    /** Variable declarators for declarations. */
    declarations?: Array<GameMakerAstNode> | null;
    /** Initializer for variable declarators or assignment right-hand sides */
    init?: GameMakerAstNode | null;
    /** Left-hand side of binary/assignment expressions */
    left?: GameMakerAstNode | null;
    /** Right-hand side of binary/assignment expressions */
    right?: GameMakerAstNode | null;
    /** Operator token for binary/unary/infix nodes */
    operator?: string | null;
    /** Function or class identifier node, or id name as a string for historical shapes */
    id?: string | GameMakerAstNode | null;
    /** Name for identifiers; included for flexible access in code (may be a node or string) */
    name?: string | GameMakerAstNode | null;
    /** Parent pointer for nodes that maintain parent links */
    parent?: GameMakerAstNode | null;
    /** Parameters for function declarations or lambdas */
    params?: Array<GameMakerAstNode> | null;
    /** Properties for struct-like nodes */
    properties?: Array<GameMakerAstNode> | null;
    /** Whether a struct/array/object literal has a trailing comma */
    hasTrailingComma?: boolean;
    /** Value for literal nodes */
    value?: string | number | boolean | null;
    /** Raw string representation of the value (used for preserving formatting) */
    raw?: string | null;
}

export type MutableGameMakerAstNode = GameMakerAstNode & Record<string, unknown>;

// Minimal, discriminated node subtypes used by type guards in core helpers.
export interface IdentifierNode extends GameMakerAstNode {
    type: "Identifier";
    name: string;
}

export interface LiteralNode extends GameMakerAstNode {
    type: "Literal";
    value?: string | number | boolean | null;
}

export interface AssignmentPatternNode extends GameMakerAstNode {
    type: "AssignmentPattern";
    left?: GameMakerAstNode;
    right?: GameMakerAstNode;
}

export interface MemberIndexExpressionNode extends GameMakerAstNode {
    type: "MemberIndexExpression";
    object?: GameMakerAstNode;
    property?: Array<GameMakerAstNode> | null;
}

export interface CallExpressionNode extends GameMakerAstNode {
    type: "CallExpression";
    object?: GameMakerAstNode;
    arguments?: Array<GameMakerAstNode> | null;
}

export interface ParenthesizedExpressionNode extends GameMakerAstNode {
    type: "ParenthesizedExpression";
    expression?: GameMakerAstNode;
}

export interface VariableDeclarationNode extends GameMakerAstNode {
    type: "VariableDeclaration";
    declarations?: VariableDeclaratorNode[];
    kind?: "var" | "global" | "static" | (string & {});
}

export interface VariableDeclaratorNode extends GameMakerAstNode {
    type: "VariableDeclarator";
    id?: GameMakerAstNode;
    init?: GameMakerAstNode | null;
}

/**
 * Define statements may stash a replacement directive token (e.g., `#region`)
 * so formatter helpers can reason about the directive context.
 */
export interface DefineStatementNode extends GameMakerAstNode {
    type: "DefineStatement";
    replacementDirective?: string | null;
}

/**
 * Contract for the root of a GameMaker AST.
 *
 * Program nodes appear at the head of every parsed source and are the
 * boundary for transpilation, refactoring, symbol extraction, and project
 * indexing. They are deliberately typed as a discriminated record so any
 * collaborator — a canonical parser output, a hand-built test double, or a
 * cross-realm facade — can satisfy the contract without sharing a prototype
 * chain with the parser's concrete class.
 *
 * The `body` shape mirrors the {@link GameMakerAstNode.body} field and is
 * required to be an array so consumers can iterate the top-level statements
 * without a secondary `Array.isArray` guard. Producers that omit or
 * mis-shape `body` should fail the {@link isProgramNode} contract check
 * rather than silently ship a malformed program.
 */
export interface ProgramNode extends GameMakerAstNode {
    type: "Program";
    body: Array<unknown>;
}
