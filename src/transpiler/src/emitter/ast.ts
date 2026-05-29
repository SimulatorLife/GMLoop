/**
 * AST type definitions for the transpiler emitter.
 *
 * DUPLICATION WARNING: Many of these type definitions (IdentifierMetadata,
 * BaseNode, ProgramNode, etc.) are duplicated from or overlap with types defined in
 * the Core and Parser packages.
 *
 * CURRENT STATE: The transpiler defines its own AST types because it evolved separately
 * from the main parser and Core packages. This duplication creates maintenance burden:
 *   - Changes to AST structure in the parser must be manually propagated here.
 *   - Type mismatches between packages can cause runtime errors that TypeScript doesn't catch.
 *   - It's unclear which definition is the "source of truth" for each node type.
 *
 * RECOMMENDATION: Audit the types in this file and determine:
 *   1. Which types are identical to Core/Parser and can be imported directly.
 *   2. Which types are transpiler-specific (e.g., have extra metadata for code generation)
 *      and should remain here but extend Core types.
 *   3. Which types represent shared concepts (e.g., IdentifierMetadata) and
 *      should be moved to Core so all packages can use the same definition.
 *
 * LONG-TERM GOAL: Consolidate AST types into Core, extend them in domain-specific packages
 * (Parser, Transpiler) only when necessary, and eliminate the duplication. This will make
 * cross-package AST manipulation safer and reduce the risk of type drift.
 */

/**
 * Semantic kind classification for identifiers and call targets.
 *
 * This is the canonical definition owned by the transpiler. The semantic package
 * (BasicSemanticOracle) uses a structurally compatible but independently declared
 * version of this type so that it does not create a dependency on the transpiler.
 */
export type SemKind = "local" | "self_field" | "other_field" | "global_field" | "builtin" | "script";

export interface IdentifierMetadata {
    readonly name: string;
    readonly isGlobalIdentifier?: boolean;
}

export interface BaseNode {
    readonly type: string;
}

export interface ProgramNode extends BaseNode {
    readonly type: "Program";
    readonly body: ReadonlyArray<GmlNode>;
}

export interface DefaultParameterNode extends BaseNode {
    readonly type: "DefaultParameter";
    readonly left: GmlNode;
    readonly right: GmlNode | null;
}

export interface LiteralNode extends BaseNode {
    readonly type: "Literal";
    readonly value: string | number | boolean | null;
}

export interface IdentifierNode extends BaseNode, IdentifierMetadata {
    readonly type: "Identifier";
}

export interface IdentifierStatementNode extends BaseNode {
    readonly type: "IdentifierStatement";
    readonly name: IdentifierNode;
}

export interface BinaryExpressionNode extends BaseNode {
    readonly type: "BinaryExpression";
    readonly left: GmlNode;
    readonly right: GmlNode;
    readonly operator: string;
}

export interface UnaryExpressionNode extends BaseNode {
    readonly type: "UnaryExpression";
    readonly argument: GmlNode;
    readonly operator: string;
    readonly prefix?: boolean;
}

export interface AssignmentExpressionNode extends BaseNode {
    readonly type: "AssignmentExpression";
    readonly left: GmlNode;
    readonly right: GmlNode;
    readonly operator: string;
}

export interface IncDecStatementNode extends BaseNode {
    readonly type: "IncDecStatement";
    readonly argument: GmlNode;
    readonly operator: string;
    readonly prefix?: boolean;
}

export interface ExpressionStatementNode extends BaseNode {
    readonly type: "ExpressionStatement";
    readonly expression: GmlNode;
}

export interface MemberIndexExpressionNode extends BaseNode {
    readonly type: "MemberIndexExpression";
    readonly object: GmlNode;
    readonly property: ReadonlyArray<GmlNode>;
}

export interface MemberDotExpressionNode extends BaseNode {
    readonly type: "MemberDotExpression";
    readonly object: GmlNode;
    readonly property: GmlNode;
}

export interface CallExpressionNode extends BaseNode {
    readonly type: "CallExpression";
    readonly object: GmlNode;
    readonly arguments: ReadonlyArray<GmlNode>;
}

/**
 * Placeholder for a missing argument in a call expression.
 *
 * Represents omitted arguments such as `func(, arg2)` in GML, which should
 * be emitted as `undefined` in JavaScript to preserve positional semantics.
 */
export interface MissingOptionalArgumentNode extends BaseNode {
    readonly type: "MissingOptionalArgument";
}

export interface NewExpressionNode extends BaseNode {
    readonly type: "NewExpression";
    readonly expression: GmlNode;
    readonly arguments?: ReadonlyArray<GmlNode> | null;
}

export interface BlockStatementNode extends BaseNode {
    readonly type: "BlockStatement";
    readonly body: ReadonlyArray<GmlNode>;
}

export interface ParenthesizedExpressionNode extends BaseNode {
    readonly type: "ParenthesizedExpression";
    readonly expression: GmlNode;
}

export interface TemplateStringTextNode extends BaseNode {
    readonly type: "TemplateStringText";
    readonly value: string;
}

export interface TemplateStringExpressionNode extends BaseNode {
    readonly type: "TemplateStringExpression";
    readonly atoms: ReadonlyArray<GmlNode | TemplateStringTextNode>;
}

export interface IfStatementNode extends BaseNode {
    readonly type: "IfStatement";
    readonly test: GmlNode;
    readonly consequent: GmlNode;
    readonly alternate?: GmlNode | null;
}

export interface ForStatementNode extends BaseNode {
    readonly type: "ForStatement";
    readonly init?: GmlNode | null;
    readonly test?: GmlNode | null;
    readonly update?: GmlNode | null;
    readonly body: GmlNode;
}

export interface WhileStatementNode extends BaseNode {
    readonly type: "WhileStatement";
    readonly test: GmlNode;
    readonly body: GmlNode;
}

export interface DoUntilStatementNode extends BaseNode {
    readonly type: "DoUntilStatement";
    readonly test: GmlNode;
    readonly body: GmlNode;
}

export interface WithStatementNode extends BaseNode {
    readonly type: "WithStatement";
    readonly test: GmlNode;
    readonly body: GmlNode;
}

export interface ReturnStatementNode extends BaseNode {
    readonly type: "ReturnStatement";
    readonly argument?: GmlNode | null;
}

export interface ThrowStatementNode extends BaseNode {
    readonly type: "ThrowStatement";
    readonly argument?: GmlNode | null;
}

export interface TryStatementNode extends BaseNode {
    readonly type: "TryStatement";
    readonly block: GmlNode;
    readonly handler?: CatchClauseNode | null;
    readonly finalizer?: FinallyClauseNode | null;
}

export interface CatchClauseNode extends BaseNode {
    readonly type: "CatchClause";
    readonly param?: GmlNode | null;
    readonly body: BlockStatementNode;
}

export interface FinallyClauseNode extends BaseNode {
    readonly type: "FinallyClause";
    readonly body: BlockStatementNode;
}

export interface RepeatStatementNode extends BaseNode {
    readonly type: "RepeatStatement";
    readonly test: GmlNode;
    readonly body: GmlNode;
}

export interface SwitchCaseNode {
    readonly test: GmlNode | null;
    readonly body: ReadonlyArray<GmlNode>;
}

export interface SwitchStatementNode extends BaseNode {
    readonly type: "SwitchStatement";
    readonly discriminant: GmlNode;
    readonly cases: ReadonlyArray<SwitchCaseNode>;
}

export interface GlobalVarStatementNode extends BaseNode {
    readonly type: "GlobalVarStatement";
    readonly declarations: ReadonlyArray<VariableDeclaratorNode>;
}

export interface VariableDeclarationNode extends BaseNode {
    readonly type: "VariableDeclaration";
    readonly kind: "var" | "let" | "const";
    readonly declarations: ReadonlyArray<VariableDeclaratorNode>;
}

export interface VariableDeclaratorNode extends BaseNode {
    readonly type: "VariableDeclarator";
    readonly id: IdentifierNode;
    readonly init?: GmlNode | null;
}

export interface TernaryExpressionNode extends BaseNode {
    readonly type: "TernaryExpression";
    readonly test: GmlNode;
    readonly consequent: GmlNode;
    readonly alternate: GmlNode;
}

export interface ArrayExpressionNode extends BaseNode {
    readonly type: "ArrayExpression";
    readonly elements: ReadonlyArray<GmlNode>;
}

export interface StructPropertyNode {
    readonly name: string | IdentifierNode;
    readonly value: GmlNode;
}

export interface StructExpressionNode extends BaseNode {
    readonly type: "StructExpression";
    readonly properties: ReadonlyArray<StructPropertyNode>;
}

export interface EnumMemberNode {
    readonly name: string | IdentifierNode;
    readonly initializer?: GmlNode | string | number | null;
}

export interface EnumDeclarationNode extends BaseNode {
    readonly type: "EnumDeclaration";
    readonly name: GmlNode;
    readonly members: ReadonlyArray<EnumMemberNode>;
}

export interface MacroDeclarationNode extends BaseNode {
    readonly type: "MacroDeclaration";
    readonly name: GmlNode;
    readonly tokens: ReadonlyArray<string>;
}

export interface FunctionDeclarationNode extends BaseNode {
    readonly type: "FunctionDeclaration";
    readonly id?: GmlNode | string | null;
    readonly params: ReadonlyArray<GmlNode | string>;
    readonly body: GmlNode;
}

export interface ConstructorParentClauseNode extends BaseNode {
    readonly type: "ConstructorParentClause";
    readonly id: GmlNode | string | null;
    readonly params: ReadonlyArray<GmlNode>;
}

export interface ConstructorDeclarationNode extends BaseNode {
    readonly type: "ConstructorDeclaration";
    readonly id?: string | null;
    readonly params: ReadonlyArray<GmlNode | string>;
    readonly body: GmlNode;
    readonly parent?: ConstructorParentClauseNode | null;
}

export interface BreakStatementNode extends BaseNode {
    readonly type: "BreakStatement";
}

export interface ContinueStatementNode extends BaseNode {
    readonly type: "ContinueStatement";
}

export interface ExitStatementNode extends BaseNode {
    readonly type: "ExitStatement";
}

export interface DeleteStatementNode extends BaseNode {
    readonly type: "DeleteStatement";
    readonly operator: "delete";
    readonly argument: GmlNode;
}

export interface RegionStatementNode extends BaseNode {
    readonly type: "RegionStatement";
    readonly name?: string | null;
}

export interface EndRegionStatementNode extends BaseNode {
    readonly type: "EndRegionStatement";
    readonly name?: string | null;
}

export interface DefineStatementNode extends BaseNode {
    readonly type: "DefineStatement";
    readonly name?: string | null;
    readonly replacementDirective?: string | null;
    readonly replacementSuffix?: string | null;
}

export type StatementNode =
    | IdentifierStatementNode
    | ExpressionStatementNode
    | IncDecStatementNode
    | BlockStatementNode
    | IfStatementNode
    | ForStatementNode
    | WhileStatementNode
    | DoUntilStatementNode
    | WithStatementNode
    | ReturnStatementNode
    | ThrowStatementNode
    | TryStatementNode
    | RepeatStatementNode
    | SwitchStatementNode
    | GlobalVarStatementNode
    | VariableDeclarationNode
    | BreakStatementNode
    | ContinueStatementNode
    | ExitStatementNode
    | DeleteStatementNode
    | FunctionDeclarationNode
    | ConstructorDeclarationNode
    | EnumDeclarationNode
    | MacroDeclarationNode
    | RegionStatementNode
    | EndRegionStatementNode
    | DefineStatementNode;

export type ExpressionNode =
    | DefaultParameterNode
    | LiteralNode
    | IdentifierNode
    | MissingOptionalArgumentNode
    | BinaryExpressionNode
    | UnaryExpressionNode
    | AssignmentExpressionNode
    | MemberIndexExpressionNode
    | MemberDotExpressionNode
    | CallExpressionNode
    | NewExpressionNode
    | ParenthesizedExpressionNode
    | TernaryExpressionNode
    | ArrayExpressionNode
    | TemplateStringExpressionNode
    | StructExpressionNode;

export type GmlNode =
    | ProgramNode
    | StatementNode
    | ExpressionNode
    | VariableDeclaratorNode
    | CatchClauseNode
    | FinallyClauseNode
    | TemplateStringTextNode
    | ConstructorParentClauseNode;

export interface EmitOptions {
    readonly globalsIdent: string;
    readonly callScriptIdent: string;
    /**
     * Identifier (or property expression) that resolves `with` targets.
     * Defaults to `globalThis.__resolve_with_targets`.
     */
    readonly resolveWithTargetsIdent: string;
}

/**
 * Analyzes identifiers to determine their semantic kind, name, and qualified
 * symbol. Used by the transpiler to generate correct variable references.
 */
export interface IdentifierAnalyzer {
    kindOfIdent(node: IdentifierNode | IdentifierMetadata | null | undefined): SemKind;
    nameOfIdent(node: IdentifierNode | IdentifierMetadata | null | undefined): string;
    qualifiedSymbol(node: IdentifierNode | IdentifierMetadata | null | undefined): string | null;
}

/**
 * Analyzes call expression targets to classify and resolve them.
 * Used by the transpiler to handle script calls and built-in functions.
 */
export interface CallTargetAnalyzer {
    callTargetKind(node: CallExpressionNode): "script" | "builtin" | "unknown";
    callTargetSymbol(node: CallExpressionNode): string | null;
}
