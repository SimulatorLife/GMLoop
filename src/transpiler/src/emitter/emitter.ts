import { Core } from "@gmloop/core";

import type {
    ArrayExpressionNode,
    AssignmentExpressionNode,
    BinaryExpressionNode,
    BlockStatementNode,
    CallExpressionNode,
    CallTargetAnalyzer,
    CatchClauseNode,
    ConstructorDeclarationNode,
    ConstructorParentClauseNode,
    DefaultParameterNode,
    DefineStatementNode,
    DeleteStatementNode,
    DoUntilStatementNode,
    EmitOptions,
    EndRegionStatementNode,
    EnumDeclarationNode,
    EnumMemberNode,
    FinallyClauseNode,
    ForStatementNode,
    FunctionDeclarationNode,
    GlobalVarStatementNode,
    GmlNode,
    IdentifierAnalyzer,
    IdentifierMetadata,
    IdentifierNode,
    IfStatementNode,
    IncDecStatementNode,
    LiteralNode,
    MacroDeclarationNode,
    MemberDotExpressionNode,
    MemberIndexExpressionNode,
    NewExpressionNode,
    ProgramNode,
    RegionStatementNode,
    RepeatStatementNode,
    ReturnStatementNode,
    StructExpressionNode,
    StructPropertyNode,
    SwitchStatementNode,
    TemplateStringExpressionNode,
    TemplateStringTextNode,
    TernaryExpressionNode,
    ThrowStatementNode,
    TryStatementNode,
    UnaryExpressionNode,
    VariableDeclarationNode,
    VariableDeclaratorNode,
    WhileStatementNode,
    WithStatementNode
} from "./ast.js";
import { emitBuiltinFunction, isBuiltinFunction } from "./builtins.js";
import { wrapConditional, wrapConditionalBody, wrapRawBody } from "./code-wrapping.js";
import {
    tryFoldConstantExpression,
    tryFoldConstantTernaryExpression,
    tryFoldConstantUnaryExpression
} from "./constant-folding.js";
import { lowerEnumDeclaration } from "./enum-lowering.js";
import { escapeTemplateText, stringifyStructKey } from "./js-string-utils.js";
import { normalizeGmlNumericLiteral } from "./literal-normalization.js";
import { collectGlobalVarNames } from "./local-variable-collector.js";
import { mapBinaryOperator, mapUnaryOperator } from "./operator-mapping.js";
import { ensureStatementTerminated } from "./statement-termination-policy.js";
import { StringBuilder } from "./string-builder.js";
import { lowerWithStatement } from "./with-lowering.js";

type StatementLike = GmlNode | undefined | null;

const DEFAULT_OPTIONS: EmitOptions = Object.freeze({
    globalsIdent: "global",
    callScriptIdent: "__call_script",
    resolveWithTargetsIdent: "globalThis.__resolve_with_targets"
});

export class GmlToJsEmitter {
    private readonly identifierAnalyzer: IdentifierAnalyzer;
    private readonly callTargetAnalyzer: CallTargetAnalyzer;
    private readonly options: EmitOptions;
    private readonly globalVars: Set<string>;
    /**
     * Script symbol IDs referenced by call expressions encountered during emission.
     *
     * Populated incrementally as the AST is walked: every `CallExpression` whose
     * target kind is `"script"` adds its resolved symbol (or name) here. The set
     * is readable after `emit()` returns via `getDependencies()`, allowing the
     * caller to attach a dependency list to the emitted patch without requiring
     * a separate analysis pass.
     */
    private readonly scriptRefs: Set<string>;
    private readonly visitNode = (node: GmlNode): string => this.visit(node);

    constructor(semantic: IdentifierAnalyzer & CallTargetAnalyzer, options: Partial<EmitOptions> = {}) {
        this.identifierAnalyzer = semantic;
        this.callTargetAnalyzer = semantic;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.globalVars = new Set();
        this.scriptRefs = new Set();
    }

    /**
     * Return the set of script symbol IDs that were referenced during emission.
     *
     * Each element is the SCIP-style symbol string used to route the call through
     * the hot-reload wrapper (e.g. `"gml/script/scr_player_move"`). When a symbol
     * ID is not available the raw script name is used instead.
     *
     * The returned set is only meaningful after `emit()` has been called. It is
     * populated incrementally as script calls are encountered in the AST, so it
     * will be empty for programs that contain no script calls.
     *
     * @returns An immutable view of the script references encountered during emission
     */
    getDependencies(): ReadonlySet<string> {
        return this.scriptRefs;
    }

    emit(ast: StatementLike): string {
        if (!ast) {
            return "";
        }
        // Pre-collect all globalvar-declared names before walking the AST so that
        // identifiers referenced before their `globalvar` declaration (a legal GML
        // forward reference) are emitted as `global.<name>` rather than bare names.
        if (ast.type === "Program") {
            for (const name of collectGlobalVarNames(ast)) {
                this.globalVars.add(name);
            }
        }
        return this.visit(ast);
    }

    private visit(ast: GmlNode): string {
        // Safety fallback: the parser now wraps all hex/binary tokens in Literal nodes,
        // but certain code paths (e.g., enum normalizeEnumInitializer, future parser
        // updates) may still produce raw primitive values in AST positions.
        // Handling them here prevents silent empty-string emission.
        if (typeof ast === "string") {
            return normalizeGmlNumericLiteral(ast);
        }
        if (typeof ast === "number") {
            return String(ast);
        }
        switch (ast.type) {
            case "DefaultParameter": {
                return this.visitDefaultParameter(ast);
            }
            case "Literal": {
                return this.visitLiteral(ast);
            }
            case "Identifier": {
                return this.visitIdentifier(ast);
            }
            case "MissingOptionalArgument": {
                return "undefined";
            }
            case "IdentifierStatement": {
                return `${this.visit(ast.name)};`;
            }
            case "BinaryExpression": {
                return this.visitBinaryExpression(ast);
            }
            case "UnaryExpression": {
                return this.visitUnaryExpression(ast);
            }
            case "AssignmentExpression": {
                return this.visitAssignmentExpression(ast);
            }
            case "CatchClause": {
                return this.visitCatchClause(ast);
            }
            case "IncDecStatement": {
                return this.visitIncDecStatement(ast);
            }
            case "ExpressionStatement": {
                return `${this.visit(ast.expression)};`;
            }
            case "MemberIndexExpression": {
                return this.visitMemberIndexExpression(ast);
            }
            case "MemberDotExpression": {
                return this.visitMemberDotExpression(ast);
            }
            case "CallExpression": {
                return this.visitCallExpression(ast);
            }
            case "NewExpression": {
                return this.visitNewExpression(ast);
            }
            case "Program": {
                return this.visitProgram(ast);
            }
            case "BlockStatement": {
                return this.visitBlockStatement(ast);
            }
            case "IfStatement": {
                return this.visitIfStatement(ast);
            }
            case "ForStatement": {
                return this.visitForStatement(ast);
            }
            case "WhileStatement": {
                return this.visitWhileStatement(ast);
            }
            case "DoUntilStatement": {
                return this.visitDoUntilStatement(ast);
            }
            case "WithStatement": {
                return this.visitWithStatement(ast);
            }
            case "ReturnStatement": {
                return this.visitReturnStatement(ast);
            }
            case "BreakStatement": {
                return "break";
            }
            case "ContinueStatement": {
                return "continue";
            }
            case "ExitStatement": {
                return "return";
            }
            case "DeleteStatement": {
                return this.visitDeleteStatement(ast);
            }
            case "ThrowStatement": {
                return this.visitThrowStatement(ast);
            }
            case "TryStatement": {
                return this.visitTryStatement(ast);
            }
            case "FinallyClause": {
                return this.visitFinallyClause(ast);
            }
            case "RepeatStatement": {
                return this.visitRepeatStatement(ast);
            }
            case "SwitchStatement": {
                return this.visitSwitchStatement(ast);
            }
            case "GlobalVarStatement": {
                return this.visitGlobalVarStatement(ast);
            }
            case "VariableDeclaration": {
                return this.visitVariableDeclaration(ast);
            }
            case "VariableDeclarator": {
                return this.visitVariableDeclarator(ast);
            }
            case "ParenthesizedExpression": {
                return `(${this.visit(ast.expression)})`;
            }
            case "TernaryExpression": {
                return this.visitTernaryExpression(ast);
            }
            case "ArrayExpression": {
                return this.visitArrayExpression(ast);
            }
            case "StructExpression": {
                return this.visitStructExpression(ast);
            }
            case "TemplateStringExpression": {
                return this.visitTemplateStringExpression(ast);
            }
            case "TemplateStringText": {
                return this.visitTemplateStringText(ast);
            }
            case "EnumDeclaration": {
                return this.visitEnumDeclaration(ast);
            }
            case "MacroDeclaration": {
                return this.visitMacroDeclaration(ast);
            }
            case "FunctionDeclaration": {
                return this.visitFunctionDeclaration(ast);
            }
            case "ConstructorDeclaration": {
                return this.visitConstructorDeclaration(ast);
            }
            case "ConstructorParentClause": {
                return "";
            }
            case "RegionStatement": {
                return this.visitRegionStatement(ast);
            }
            case "EndRegionStatement": {
                return this.visitEndRegionStatement(ast);
            }
            case "DefineStatement": {
                return this.visitDefineStatement(ast);
            }
            default: {
                return this.handleUnknownNode(ast);
            }
        }
    }

    /**
     * Handle AST nodes that don't have explicit visitor methods.
     * This serves as a safety net for unimplemented or unexpected node types.
     *
     * Currently returns an empty string to maintain backward compatibility.
     *
     * @param ast - The unhandled AST node
     * @returns Empty string (node is skipped in output)
     */
    private handleUnknownNode(_ast: GmlNode): string {
        void _ast;
        return "";
    }

    private visitDefaultParameter(ast: DefaultParameterNode): string {
        if (!ast.right) {
            return this.visit(ast.left);
        }
        return `${this.visit(ast.left)} = ${this.visit(ast.right)}`;
    }

    private visitLiteral(ast: LiteralNode): string {
        const value = ast.value;
        if (typeof value === "string") {
            return normalizeGmlNumericLiteral(value);
        }
        return String(value);
    }

    private visitIdentifier(ast: IdentifierNode): string {
        const kind = this.identifierAnalyzer.kindOfIdent(ast);
        const name = this.identifierAnalyzer.nameOfIdent(ast);
        if (this.globalVars.has(name)) {
            return `${this.options.globalsIdent}.${name}`;
        }
        switch (kind) {
            case "self_field": {
                return `self.${name}`;
            }
            case "other_field": {
                return `other.${name}`;
            }
            case "global_field": {
                return `${this.options.globalsIdent}.${name}`;
            }
            case "script":
            case "local":
            case "builtin": {
                return name;
            }
            default: {
                return name;
            }
        }
    }

    private visitBinaryExpression(ast: BinaryExpressionNode): string {
        // Try constant folding first for compile-time optimization
        const folded = tryFoldConstantExpression(ast);
        if (folded !== null) {
            // Emit the folded constant directly.
            // JSON.stringify guarantees valid JavaScript string escaping
            // for control characters (newlines, tabs, etc.) and quotes.
            if (typeof folded === "string") {
                return JSON.stringify(folded);
            }
            return String(folded);
        }
        // Fall back to runtime evaluation
        const left = this.visit(ast.left);
        const right = this.visit(ast.right);
        // Special case: GML `div` is integer division truncating toward zero.
        // There is no single JavaScript operator for this; lower to Math.trunc(a / b).
        if (ast.operator === "div") {
            return `Math.trunc(${left} / ${right})`;
        }
        const op = mapBinaryOperator(ast.operator);
        return `(${left} ${op} ${right})`;
    }

    private visitUnaryExpression(ast: UnaryExpressionNode): string {
        // Try constant folding first for compile-time optimization
        const folded = tryFoldConstantUnaryExpression(ast);
        if (folded !== null) {
            // Emit the folded constant directly
            return String(folded);
        }
        // Fall back to runtime evaluation
        const operand = this.visit(ast.argument);
        const op = mapUnaryOperator(ast.operator);
        if (ast.argument.type === "Literal") {
            return `${op}${operand}`;
        }
        return ast.prefix === false ? `(${operand})${op}` : `${op}(${operand})`;
    }

    private visitAssignmentExpression(ast: AssignmentExpressionNode): string {
        const left = this.visit(ast.left);
        const right = this.visit(ast.right);
        return `${left} ${ast.operator} ${right}`;
    }

    private visitIncDecStatement(ast: IncDecStatementNode): string {
        const argument = this.visit(ast.argument);
        return ast.prefix ? `${ast.operator}${argument}` : `${argument}${ast.operator}`;
    }

    private visitMemberIndexExpression(ast: MemberIndexExpressionNode): string {
        const object = this.visit(ast.object);
        const props = ast.property ?? [];
        // Fast path: single index access (most common case)
        if (props.length === 1) {
            return `${object}[${this.visit(props[0])}]`;
        }
        // Fast path: empty indices
        if (props.length === 0) {
            return object;
        }
        // Multiple indices: use StringBuilder for efficiency
        const builder = new StringBuilder(props.length + 1);
        builder.append(object);
        for (const prop of props) {
            builder.append(`[${this.visit(prop)}]`);
        }
        return builder.toString();
    }

    private visitMemberDotExpression(ast: MemberDotExpressionNode): string {
        const object = this.visit(ast.object);
        const property = this.resolveMemberDotProperty(ast.property);
        return `${object}.${property}`;
    }

    private visitCallExpression(ast: CallExpressionNode): string {
        const kind = this.callTargetAnalyzer.callTargetKind(ast);

        // Fast path: builtin functions. Avoid eagerly joining arguments here so
        // the builtin path only visits each argument once.
        if (kind === "builtin") {
            const builtinName = this.resolveIdentifierName(ast.object);
            if (builtinName && isBuiltinFunction(builtinName)) {
                return emitBuiltinFunction(builtinName, this.visitArguments(ast.arguments));
            }
        }

        const argsList = this.joinArguments(ast.arguments);

        if (kind === "script") {
            const scriptSymbol = this.callTargetAnalyzer.callTargetSymbol(ast);
            const scriptId = scriptSymbol ?? this.resolveIdentifierName(ast.object) ?? this.visit(ast.object);
            // Record this script reference for dependency tracking. The set is
            // populated during the single emission pass and exposed via getDependencies().
            this.scriptRefs.add(scriptId);
            return `${this.options.callScriptIdent}(${JSON.stringify(scriptId)}, self, other, [${argsList}])`;
        }

        const callee = this.visit(ast.object);
        return `${callee}(${argsList})`;
    }

    private visitNewExpression(ast: NewExpressionNode): string {
        const expression = this.visit(ast.expression);
        const argsList = this.joinArguments(ast.arguments ?? []);
        return `new ${expression}(${argsList})`;
    }

    private visitProgram(ast: ProgramNode): string {
        const stmts = ast.body ?? [];
        if (stmts.length === 0) {
            return "";
        }
        // Fast path: single statement
        if (stmts.length === 1) {
            const code = this.emit(stmts[0]);
            return code ? this.ensureStatementTermination(code) : "";
        }
        // Multiple statements: use StringBuilder for efficiency
        const builder = new StringBuilder(stmts.length);
        for (const stmt of stmts) {
            const code = this.emit(stmt);
            if (code) {
                builder.append(this.ensureStatementTermination(code));
            }
        }
        return builder.toString("\n");
    }

    private visitBlockStatement(ast: BlockStatementNode): string {
        const stmts = ast.body ?? [];
        if (stmts.length === 0) {
            return "{\n}";
        }
        // Build block body with StringBuilder for efficiency
        // Capacity: statements count + opening brace + closing brace
        const builder = new StringBuilder(stmts.length + 2);
        builder.append("{\n");
        for (const stmt of stmts) {
            const code = this.emit(stmt);
            if (code) {
                builder.append(`${this.ensureStatementTermination(code)}\n`);
            }
        }
        builder.append("}");
        return builder.toString();
    }

    private visitIfStatement(ast: IfStatementNode): string {
        const test = wrapConditional(ast.test, this.visitNode);
        const consequent = wrapConditionalBody(ast.consequent, this.visitNode);
        if (!ast.alternate) {
            return `if ${test}${consequent}`;
        }
        const alternate =
            ast.alternate.type === "IfStatement"
                ? ` else ${this.visit(ast.alternate)}`
                : ` else ${wrapConditionalBody(ast.alternate, this.visitNode)}`;
        return `if ${test}${consequent}${alternate}`;
    }

    private visitForStatement(ast: ForStatementNode): string {
        const init = ast.init ? this.visit(ast.init) : "";
        const test = ast.test ? this.visit(ast.test) : "";
        const update = ast.update ? this.visit(ast.update) : "";
        const body = wrapConditionalBody(ast.body, this.visitNode);
        return `for (${init}; ${test}; ${update})${body}`;
    }

    private visitWhileStatement(ast: WhileStatementNode): string {
        const test = wrapConditional(ast.test, this.visitNode);
        const body = wrapConditionalBody(ast.body, this.visitNode);
        return `while ${test}${body}`;
    }

    private visitDoUntilStatement(ast: DoUntilStatementNode): string {
        const testExpr = wrapConditional(ast.test, this.visitNode, true);
        const body = wrapConditionalBody(ast.body, this.visitNode);
        return `do${body} while (!(${testExpr}))`;
    }

    private visitWithStatement(ast: WithStatementNode): string {
        const testExpr = wrapConditional(ast.test, this.visitNode, true) || "undefined";
        const rawBody = wrapRawBody(ast.body, this.visitNode);
        // Indent body by adding 8 spaces to the start of each non-empty line.
        // The regex ^(?=.) matches start-of-line followed by any character (via lookahead),
        // which means it matches non-empty lines including whitespace-only lines, matching
        // the original split/map/join behavior but with a single allocation.
        const indentedBody = rawBody.replaceAll(/^(?=.)/gm, "        ");

        return lowerWithStatement(testExpr, indentedBody, this.options.resolveWithTargetsIdent);
    }

    private visitReturnStatement(ast: ReturnStatementNode): string {
        if (ast.argument) {
            return `return ${this.visit(ast.argument)}`;
        }
        return "return";
    }

    private visitDeleteStatement(ast: DeleteStatementNode): string {
        const argument = this.visit(ast.argument);
        return `delete ${argument}`;
    }

    private visitThrowStatement(ast: ThrowStatementNode): string {
        if (ast.argument) {
            return `throw ${this.visit(ast.argument)}`;
        }
        return "throw";
    }

    private visitTryStatement(ast: TryStatementNode): string {
        const block = wrapConditionalBody(ast.block, this.visitNode);
        const handler = ast.handler ? ` ${this.visitCatchClause(ast.handler)}` : "";
        const finalizer = ast.finalizer ? ` ${this.visitFinallyClause(ast.finalizer)}` : "";
        return `try${block}${handler}${finalizer}`;
    }

    private visitCatchClause(ast: CatchClauseNode): string {
        const param = ast.param ? this.visit(ast.param) : "err";
        return `catch (${param})${wrapConditionalBody(ast.body, this.visitNode)}`;
    }

    private visitFinallyClause(ast: FinallyClauseNode): string {
        return `finally${wrapConditionalBody(ast.body, this.visitNode)}`;
    }

    private visitRepeatStatement(ast: RepeatStatementNode): string {
        const testExpr = wrapConditional(ast.test, this.visitNode, true) || "0";
        const body = wrapConditionalBody(ast.body, this.visitNode);
        return `for (let __repeat_count = ${testExpr}; __repeat_count > 0; __repeat_count--)${body}`;
    }

    private visitSwitchStatement(ast: SwitchStatementNode): string {
        const discriminant = wrapConditional(ast.discriminant, this.visitNode);
        const caseNodes = ast.cases ?? [];
        if (caseNodes.length === 0) {
            return `switch ${discriminant} {\n}`;
        }

        // Build cases with StringBuilder for efficiency
        const builder = new StringBuilder(caseNodes.length * 2);
        for (const caseNode of caseNodes) {
            const header = caseNode.test === null ? "default:" : `case ${this.visit(caseNode.test)}:`;
            const stmts = caseNode.body ?? [];

            if (stmts.length === 0) {
                // Skip empty case bodies (fall-through cases). In GML and JavaScript,
                // when a case has no body, execution falls through to the next case label.
                // We don't emit any code for these empty cases—just the case header—so
                // that the transpiled JavaScript preserves the same fall-through semantics.
                builder.append(header);
                continue;
            }

            // Process statements for this case
            const caseBuilder = new StringBuilder(stmts.length);
            for (const stmt of stmts) {
                const code = this.visit(stmt);
                if (code) {
                    caseBuilder.append(this.ensureStatementTermination(code));
                }
            }

            if (caseBuilder.length === 0) {
                builder.append(header);
            } else {
                builder.append(`${header}\n${caseBuilder.toString("\n")}`);
            }
        }

        return `switch ${discriminant} {\n${builder.toString("\n")}\n}`;
    }

    private visitGlobalVarStatement(ast: GlobalVarStatementNode): string {
        if (!ast.declarations || ast.declarations.length === 0) {
            return "";
        }
        const globalsIdent = this.options.globalsIdent;
        return this.joinTruthy(
            ast.declarations.map((decl) => {
                const identifier = this.resolveIdentifierName(decl.id);
                if (!identifier) {
                    return "";
                }
                this.globalVars.add(identifier);
                return `if (!Object.prototype.hasOwnProperty.call(${globalsIdent}, "${identifier}")) { ${globalsIdent}.${identifier} = undefined; }`;
            })
        );
    }

    private visitVariableDeclaration(ast: VariableDeclarationNode): string {
        const decls = ast.declarations;
        // Fast path: single declaration without initialization
        if (decls.length === 1 && !decls[0].init) {
            return `${ast.kind} ${this.visit(decls[0].id)}`;
        }
        // Fast path: single declaration with initialization
        if (decls.length === 1 && decls[0].init) {
            const decl = decls[0];
            const id = this.visit(decl.id);
            const init = this.visit(decl.init);
            return `${ast.kind} ${id} = ${init}`;
        }
        // Multiple declarations: use StringBuilder for efficiency
        const builder = new StringBuilder(decls.length);
        for (const decl of decls) {
            const id = this.visit(decl.id);
            if (decl.init) {
                const init = this.visit(decl.init);
                builder.append(`${id} = ${init}`);
            } else {
                builder.append(id);
            }
        }
        return `${ast.kind} ${builder.toString(", ")}`;
    }

    private visitVariableDeclarator(ast: VariableDeclaratorNode): string {
        const id = this.visit(ast.id);
        if (!ast.init) {
            return id;
        }
        const init = this.visit(ast.init);
        return `${id} = ${init}`;
    }

    private visitTernaryExpression(ast: TernaryExpressionNode): string {
        const foldedBranch = tryFoldConstantTernaryExpression(ast);
        if (foldedBranch !== null) {
            return this.visit(foldedBranch);
        }

        const test = wrapConditional(ast.test, this.visitNode, true);
        const consequent = this.visit(ast.consequent);
        const alternate = this.visit(ast.alternate);
        return `(${test} ? ${consequent} : ${alternate})`;
    }

    private visitArrayExpression(ast: ArrayExpressionNode): string {
        const elements = ast.elements;
        if (!elements || elements.length === 0) {
            return "[]";
        }
        // Fast path: single element
        if (elements.length === 1) {
            return `[${this.visit(elements[0])}]`;
        }
        // Fast path: two elements (very common case)
        if (elements.length === 2) {
            return `[${this.visit(elements[0])}, ${this.visit(elements[1])}]`;
        }
        // Multiple elements: use StringBuilder to avoid intermediate array allocation
        const builder = new StringBuilder(elements.length);
        for (const el of elements) {
            builder.append(this.visit(el));
        }
        return `[${builder.toString(", ")}]`;
    }

    private visitTemplateStringExpression(ast: TemplateStringExpressionNode): string {
        const atoms = ast.atoms ?? [];
        if (atoms.length === 0) {
            return "``";
        }
        // Fast path: single static text
        if (atoms.length === 1 && atoms[0]?.type === "TemplateStringText") {
            return `\`${escapeTemplateText(atoms[0].value)}\``;
        }
        // Build template string with StringBuilder to avoid O(n²) string concatenation
        const builder = new StringBuilder(atoms.length + 2);
        builder.append("`");
        for (const atom of atoms) {
            if (!atom) {
                continue;
            }
            builder.append(
                atom.type === "TemplateStringText" ? escapeTemplateText(atom.value) : `\${${this.visit(atom)}}`
            );
        }
        builder.append("`");
        return builder.toString();
    }

    private visitTemplateStringText(ast: TemplateStringTextNode): string {
        return escapeTemplateText(ast.value);
    }

    private visitStructExpression(ast: StructExpressionNode): string {
        const props = ast.properties;
        if (!props || props.length === 0) {
            return "{}";
        }
        // Fast path: single property
        if (props.length === 1) {
            const prop = props[0];
            const key = this.resolveStructKey(prop);
            const value = this.visit(prop.value);
            return `{${key}: ${value}}`;
        }
        // Multiple properties: use StringBuilder to avoid sparse array allocation
        const builder = new StringBuilder(props.length);
        for (const prop of props) {
            const key = this.resolveStructKey(prop);
            const value = this.visit(prop.value);
            builder.append(`${key}: ${value}`);
        }
        return `{${builder.toString(", ")}}`;
    }

    private visitEnumDeclaration(ast: EnumDeclarationNode): string {
        const name = this.visit(ast.name);
        return lowerEnumDeclaration(
            name,
            ast.members ?? [],
            (node) => this.visit(node),
            (member) => this.resolveEnumMemberName(member)
        );
    }

    private visitMacroDeclaration(ast: MacroDeclarationNode): string {
        const name = this.visit(ast.name);
        const tokens = ast.tokens ?? [];
        // Join tokens without spaces as they are pre-tokenized by the parser.
        // For example, 'global.config' is tokenized as ['global', '.', 'config']
        const value = tokens.join("");
        return `const ${name} = ${value};`;
    }

    private visitFunctionDeclaration(ast: FunctionDeclarationNode): string {
        const id = ast.id ? (typeof ast.id === "string" ? ast.id : this.visit(ast.id)) : "";
        return this.emitFunctionLike("function", id, ast.params, ast.body);
    }

    private visitConstructorDeclaration(ast: ConstructorDeclarationNode): string {
        const id = ast.id ?? "";
        const parentConstructorCall = this.emitConstructorParentCall(ast.parent ?? null);
        return this.emitFunctionLike("function", id, ast.params, ast.body, parentConstructorCall);
    }

    /**
     * Visit a RegionStatement node.
     * Region statements are GML preprocessor directives used for code folding
     * in the GameMaker IDE. They have no runtime effect and should not appear
     * in the transpiled JavaScript output.
     *
     * @param ast - The RegionStatement node
     * @returns Empty string (region markers are stripped from output)
     */
    private visitRegionStatement(_ast: RegionStatementNode): string {
        void _ast;
        return "";
    }

    /**
     * Visit an EndRegionStatement node.
     * EndRegion statements are GML preprocessor directives that close a region block.
     * They have no runtime effect and should not appear in the transpiled JavaScript output.
     *
     * @param ast - The EndRegionStatement node
     * @returns Empty string (endregion markers are stripped from output)
     */
    private visitEndRegionStatement(_ast: EndRegionStatementNode): string {
        void _ast;
        return "";
    }

    /**
     * Visit a DefineStatement node.
     * DefineStatement nodes can represent various preprocessor directives including
     * #region, #endregion, and #macro. Region directives have no runtime effect.
     * Macro directives are already handled separately by MacroDeclaration nodes.
     *
     * @param ast - The DefineStatement node
     * @returns Empty string (preprocessor directives are stripped from output)
     */
    private visitDefineStatement(_ast: DefineStatementNode): string {
        void _ast;
        return "";
    }

    private emitFunctionLike(
        keyword: string,
        id: string,
        params: ReadonlyArray<GmlNode | string>,
        body: GmlNode,
        prologueStatement = ""
    ): string {
        const printedBody = this.wrapFunctionLikeBody(body, prologueStatement);
        // Fast path: no parameters
        if (!params || params.length === 0) {
            return `${keyword} ${id}()${printedBody}`;
        }
        // Build parameter list with StringBuilder to avoid sparse array allocation
        const builder = new StringBuilder(params.length);
        for (const param of params) {
            builder.append(typeof param === "string" ? param : this.visit(param));
        }
        return `${keyword} ${id}(${builder.toString(", ")})${printedBody}`;
    }

    private wrapFunctionLikeBody(body: GmlNode, prologueStatement: string): string {
        if (!prologueStatement) {
            return wrapConditionalBody(body, this.visitNode);
        }

        if (body.type !== "BlockStatement") {
            return `{\n${prologueStatement};\n${this.ensureStatementTermination(this.visit(body))}\n}`;
        }

        const statements = body.body ?? [];
        if (statements.length === 0) {
            return `{\n${prologueStatement};\n}`;
        }

        const builder = new StringBuilder(statements.length + 2);
        builder.append("{\n");
        builder.append(`${prologueStatement};\n`);
        for (const statement of statements) {
            const code = this.emit(statement);
            if (!code) {
                continue;
            }
            builder.append(`${this.ensureStatementTermination(code)}\n`);
        }
        builder.append("}");
        return builder.toString();
    }

    private emitConstructorParentCall(parentClause: ConstructorParentClauseNode | null): string {
        if (!parentClause || !parentClause.id) {
            return "";
        }

        const parentConstructorName =
            typeof parentClause.id === "string" ? parentClause.id : this.visit(parentClause.id);
        if (!parentConstructorName) {
            return "";
        }

        const parentArguments = this.joinArguments(parentClause.params ?? []);
        return `${parentConstructorName}.call(this${parentArguments ? `, ${parentArguments}` : ""})`;
    }

    private ensureStatementTermination(code: string): string {
        return ensureStatementTerminated(code);
    }

    private joinTruthy(lines: Array<string | undefined | null | false>): string {
        return Core.compactArray(lines).join("\n");
    }

    private resolveIdentifierName(node: GmlNode | IdentifierMetadata | null | undefined): string | null {
        if (!node) {
            return null;
        }
        if (typeof (node as IdentifierMetadata).name === "string") {
            return (node as IdentifierMetadata).name;
        }
        if ((node as GmlNode).type === "Identifier") {
            return this.identifierAnalyzer.nameOfIdent(node as IdentifierNode);
        }
        return null;
    }

    private resolveStructKey(prop: StructPropertyNode): string {
        if (typeof prop.name === "string") {
            return stringifyStructKey(prop.name);
        }
        return this.visit(prop.name);
    }

    private resolveEnumMemberName(member: EnumMemberNode): string {
        if (typeof member.name === "string") {
            return member.name;
        }
        return this.visit(member.name);
    }

    private resolveMemberDotProperty(node: GmlNode): string {
        if (node.type === "Identifier") {
            return this.identifierAnalyzer.nameOfIdent(node);
        }
        return this.visit(node);
    }

    /**
     * Visit an array of argument nodes and return an array of strings.
     * This is optimized for the builtin function path which needs the array.
     */
    private visitArguments(args: readonly GmlNode[]): string[] {
        // Fast path: no arguments
        if (args.length === 0) {
            return [];
        }
        // Fast path: single argument
        if (args.length === 1) {
            return [this.visit(args[0])];
        }
        // General case: map all arguments
        return args.map((arg) => this.visit(arg));
    }

    /**
     * Join argument nodes into a comma-separated string.
     * This is optimized to avoid creating intermediate arrays.
     */
    private joinArguments(args: readonly GmlNode[]): string {
        // Fast path: no arguments
        if (args.length === 0) {
            return "";
        }
        // Fast path: single argument
        if (args.length === 1) {
            return this.visit(args[0]);
        }
        // Fast path: two arguments (very common)
        if (args.length === 2) {
            return `${this.visit(args[0])}, ${this.visit(args[1])}`;
        }
        // General case: use StringBuilder for 3+ arguments
        const builder = new StringBuilder(args.length);
        for (const arg of args) {
            builder.append(this.visit(arg));
        }
        return builder.toString(", ");
    }
}
