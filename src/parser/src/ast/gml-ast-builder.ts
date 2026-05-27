import { Core, type GameMakerAstLocation, type GameMakerAstNode } from "@gmloop/core";
import type { Token } from "antlr4";

import GameMakerLanguageParserVisitor from "../runtime/game-maker-language-parser-visitor.js";
import type {
    GlobalIdentifierTracker,
    IdentifierRoleApplicator,
    IdentifierRoleCloner,
    IdentifierRoleContextController,
    ParserContext,
    ParserContextWithMethods,
    ParserOptions,
    ParserToken,
    ScopeLifecycle
} from "../types/index.js";
import BinaryExpressionDelegate from "./binary-expression-delegate.js";

type IdentifierRole = {
    type: string;
    kind: string;
    tags?: string[];
    scopeOverride?: string;
};

type ParserVisitorInstance = InstanceType<typeof GameMakerLanguageParserVisitor>;
type MutableParserVisitor = ParserVisitorInstance & {
    [methodName: string]: (...args: Array<unknown>) => unknown;
};

type ParserScopeTracker =
    | (GlobalIdentifierTracker &
          IdentifierRoleContextController &
          IdentifierRoleApplicator &
          IdentifierRoleCloner &
          ScopeLifecycle)
    | null;
type DirectiveKeyword = "define" | "macro";
type DirectiveKeywordRange = {
    start: number;
    end: number;
};
type ParsedDefineMacroDirective = {
    leadingWhitespace: string;
    macroName: string;
    macroValue: string;
};

const GLOBAL_SCOPE_OVERRIDE_KEYWORD = "global" as const;

/**
 * Create a parser visitor instance whose generated `visit*` methods proxy to
 * the {@link host}'s implementations. The helper walks the prototype chain so
 * mixins and subclasses can expose custom visit handlers without manually
 * re-binding each method after construction.
 *
 * @param {object} host Instance containing concrete `visit*` methods. Usually a
 *     {@link GameMakerASTBuilder} but accepts any object that implements the
 *     visitor contract.
 * @returns {GameMakerLanguageParserVisitor} Visitor wired to delegate all
 *     method calls back to {@link host}.
 */
function createVisitorDelegate(host: object): MutableParserVisitor {
    const visitorInstance = new GameMakerLanguageParserVisitor();
    const visitor = visitorInstance as MutableParserVisitor;
    const prototypes: object[] = [];

    for (
        let prototype = Object.getPrototypeOf(host);
        prototype && prototype !== Object.prototype;
        prototype = Object.getPrototypeOf(prototype)
    ) {
        prototypes.push(prototype);
    }

    for (const prototype of prototypes) {
        for (const name of Object.getOwnPropertyNames(prototype)) {
            if (name === "constructor" || name === "visit" || name === "visitChildren" || !name.startsWith("visit")) {
                continue;
            }

            const method = (prototype as any)[name];
            if (typeof method !== "function") {
                continue;
            }

            visitor[name] = (...args: unknown[]) => method.apply(host, args);
        }
    }

    return visitor;
}

export default class GameMakerASTBuilder {
    options: ParserOptions;
    whitespaces: unknown[];
    operatorStack: string[];
    private scopeTracker: ParserScopeTracker;
    private binaryExpressions: any;
    private visitor: MutableParserVisitor;

    constructor(
        options: ParserOptions,
        // DESIGN QUESTION: The whitespaces parameter is an array of unknown type that
        // stores whitespace/comment information during parsing. Its type and purpose
        // are unclear:
        //   - What does it contain? Token objects? Raw strings? AST comment nodes?
        //   - Why is it passed separately instead of being part of ParserOptions?
        //   - Is it mutated during parsing, or is it read-only context?
        //
        // RECOMMENDATION: Define a proper type for whitespace data (e.g., WhitespaceToken[])
        // and either add it as a field in ParserOptions or document why it must be passed
        // separately. If it's mutable state that accumulates during parsing, consider
        // making it a private field initialized in the constructor rather than a parameter.
        whitespaces: unknown[] = []
    ) {
        this.options = options;
        this.whitespaces = whitespaces || [];
        this.operatorStack = [];
        const { enabled, createScopeTracker } = options.scopeTrackerOptions;

        if (enabled) {
            if (typeof createScopeTracker !== "function") {
                throw new TypeError("Invalid createScopeTracker function.");
            }

            this.scopeTracker = createScopeTracker();
        } else {
            this.scopeTracker = null;
        }

        this.binaryExpressions = new BinaryExpressionDelegate({
            operators: Core.BINARY_OPERATORS
        });

        this.visitor = createVisitorDelegate(this);
    }

    get globalIdentifiers(): any {
        // When scope tracking is disabled the tracker won't be present. In
        // that case callers should be able to treat global identifiers as an
        // empty collection rather than receiving an error.
        if (!this.scopeTracker) return [];
        return this.scopeTracker.globalIdentifiers;
    }

    visit(node: unknown): any {
        if (node == null) return null;
        if (Array.isArray(node)) {
            const results: any[] = [];
            for (const n of node) {
                const r = this.visit(n);
                if (r !== undefined) results.push(r);
            }
            return results;
        }
        return this.visitor.visit(node);
    }

    visitChildren(node: unknown): any {
        if (node == null) return null;
        if (Array.isArray(node)) {
            return node.map((n) => this.visitor.visitChildren(n as ParserContextWithMethods));
        }
        return this.visitor.visitChildren(node as ParserContextWithMethods);
    }

    withScope<T>(kind: string, callback: () => T): T {
        // Allow AST building to proceed even when the scope tracker is disabled
        // or uninitialized. Some callers enable scope tracking via configuration
        // (e.g., for refactoring or semantic analysis), while others (e.g., the
        // formatter in parse-only mode) do not need it. Rather than requiring
        // every caller to guard withScope invocations, we execute the callback
        // directly when no tracker is available. This maintains backward
        // compatibility with workflows that call withScope without initializing
        // scope tracking infrastructure.
        if (!this.scopeTracker) {
            return callback();
        }
        if (typeof this.scopeTracker.withScope === "function") {
            return this.scopeTracker.withScope(kind, callback);
        }
        return callback();
    }

    withIdentifierRole<T>(role: IdentifierRole, callback: () => T): T {
        // Execute the callback without tracking identifier roles when the scope
        // tracker is disabled or missing. This mirrors the withScope fallback
        // logic: workflows that do not need semantic analysis (e.g., basic
        // formatting) can still build AST nodes without initializing role
        // tracking infrastructure. The callback proceeds unconditionally,
        // allowing the builder to remain usable across different operational
        // modes without requiring every caller to check tracker availability.
        if (!this.scopeTracker) {
            return callback();
        }
        if (typeof this.scopeTracker.withRole === "function") {
            return this.scopeTracker.withRole(role, callback);
        }
        return callback();
    }

    cloneIdentifierRole(role: IdentifierRole): IdentifierRole {
        if (!this.scopeTracker) {
            // No tracker present; return a shallow copy of the role as a
            // best-effort clone so callers can mutate safely without
            // inadvertently modifying the original object.
            return { ...(role as any) } as IdentifierRole;
        }
        const clonedRole = this.scopeTracker.cloneRole(role);
        if (clonedRole) {
            return clonedRole as IdentifierRole;
        }
        return { ...(role as any) } as IdentifierRole;
    }

    ensureArray(ctx: unknown): ParserContextWithMethods[] {
        if (!ctx) return [];
        const arr = Core.toArray(ctx);
        return arr.filter((c) => c !== null && c !== undefined) as ParserContextWithMethods[];
    }

    ensureSingle(ctx: unknown): ParserContextWithMethods | null {
        if (!ctx) return null;
        return Array.isArray(ctx) ? (ctx as ParserContextWithMethods[])[0] : (ctx as ParserContextWithMethods);
    }

    ensureToken(t: unknown): { getText: () => string } | null {
        if (!t) return null;
        const actual = Array.isArray(t) ? (t as any)[0] : (t as any);
        return typeof actual?.getText === "function" ? (actual as { getText: () => string }) : null;
    }

    private resolveParserToken(tokenCandidate: unknown): ParserToken | null {
        if (!tokenCandidate || typeof tokenCandidate !== "object") {
            return null;
        }

        const tokenRecord = tokenCandidate as ParserToken & {
            symbol?: ParserToken | null;
        };

        if (tokenRecord.symbol && typeof tokenRecord.symbol === "object") {
            return tokenRecord.symbol;
        }

        return tokenRecord;
    }

    private getTokenStartIndex(token: number | Token | ParserToken | null | undefined): number | null {
        if (!token && token !== 0) {
            return null;
        }

        if (typeof token === "number") {
            return token;
        }

        if (typeof token.start === "number") {
            return token.start;
        }

        if (typeof token.startIndex === "number") {
            return token.startIndex;
        }

        return null;
    }

    private buildDirectiveKeywordRange(
        token: number | Token | ParserToken | null | undefined,
        keyword: DirectiveKeyword
    ): DirectiveKeywordRange | null {
        const start = this.getTokenStartIndex(token);
        if (typeof start !== "number") {
            return null;
        }

        return {
            start,
            end: start + `#${keyword}`.length
        };
    }

    private parseDefineMacroDirective(rawText: string): ParsedDefineMacroDirective | null {
        const macroMatch = rawText.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)(.*)$/u);
        if (!macroMatch) {
            return null;
        }

        const [, leadingWhitespace, macroName, rawValue = ""] = macroMatch;

        return {
            leadingWhitespace,
            macroName,
            macroValue: rawValue.trimStart()
        };
    }

    private createDefineMacroIdentifierNode(
        parsedMacroDirective: ParsedDefineMacroDirective,
        regionToken: ParserToken | null
    ): GameMakerAstNode {
        const fallbackIdentifierNode: GameMakerAstNode = {
            type: "Identifier",
            name: parsedMacroDirective.macroName
        };

        if (!regionToken) {
            return fallbackIdentifierNode;
        }

        const regionStartIndex = this.getTokenStartIndex(regionToken);
        if (typeof regionStartIndex !== "number") {
            return fallbackIdentifierNode;
        }

        const identifierStartIndex = regionStartIndex + parsedMacroDirective.leadingWhitespace.length;
        const identifierEndIndex = identifierStartIndex + parsedMacroDirective.macroName.length - 1;

        const startLocation: GameMakerAstLocation = {
            index: identifierStartIndex
        };
        const endLocation: GameMakerAstLocation = {
            index: identifierEndIndex
        };

        if (typeof regionToken.line === "number") {
            startLocation.line = regionToken.line;
            endLocation.line = regionToken.line;
        }

        if (typeof regionToken.column === "number") {
            const identifierStartColumn = regionToken.column + parsedMacroDirective.leadingWhitespace.length;
            startLocation.column = identifierStartColumn;
            endLocation.column = identifierStartColumn + parsedMacroDirective.macroName.length - 1;
        }

        return {
            type: "Identifier",
            name: parsedMacroDirective.macroName,
            start: startLocation,
            end: endLocation
        };
    }

    /**
     * Visit the first non-null child returned by the candidate context
     * accessors. Acts as a defensive replacement for nested null checks when
     * parsing optional grammar branches.
     *
     * @param {object | null | undefined} ctx Parser context whose children will
     *     be examined.
     * @param {Array<string>} methodNames Ordered list of child accessor method
     *     names to attempt.
     * @returns {object | null} The visited child node or `null` when no
     *     candidates are available.
     */
    visitFirstChild(ctx: ParserContext, methodNames: string[]): any {
        if (!ctx || !Array.isArray(methodNames)) {
            return null;
        }

        for (const methodName of methodNames) {
            const getter = (ctx as any)[methodName];
            if (typeof getter !== "function") {
                continue;
            }

            const child = getter.call(ctx);
            // Some parser accessors may return `null` for absent optional
            // children (or `undefined`). Treat both as "no child" so we do
            // not attempt to visit a null context which would crash the
            // visitor (ctx.accept would be called on null).
            if (child !== undefined && child !== null) {
                return this.visit(child);
            }
        }

        return null;
    }

    // Attach source location metadata (start/end line and offset) to each AST node
    // so downstream tools (formatter, linter, error reporter) can map nodes back to
    // their original source positions. We compute the end location by accounting for
    // line breaks within the token's text, which is crucial for multi-line string
    // literals or block comments that span multiple lines.
    astNode<T extends GameMakerAstNode>(ctx: ParserContext, object: T): T {
        const startLocation = this.buildLocationFromToken(ctx?.start);
        const fallbackEndLocation = this.buildLocationFromToken(ctx?.start, {
            includeLineBreakCount: true
        });
        const endLocation =
            this.buildLocationFromToken(ctx?.stop ?? ctx?.start, {
                includeLineBreakCount: true,
                useStopIndex: true
            }) ??
            fallbackEndLocation ??
            startLocation ??
            null;

        object.start = startLocation ?? null;
        object.end = endLocation ?? startLocation ?? null;

        return object;
    }

    astNodeFromToken<T extends GameMakerAstNode>(token: ParserToken, object: T): T {
        if (!token) {
            return this.astNode(this as any, object);
        }

        const startTokenCandidate = token.symbol ?? token.start ?? token.stop ?? token;
        const endTokenCandidate = token.stop ?? token.symbol ?? token.start ?? token;

        const startLocation = this.buildLocationFromToken(startTokenCandidate);
        const endLocation =
            this.buildLocationFromToken(endTokenCandidate, {
                includeLineBreakCount: true,
                useStopIndex: true
            }) ??
            this.buildLocationFromToken(startTokenCandidate, {
                includeLineBreakCount: true,
                useStopIndex: true
            });

        if (!startLocation && !endLocation) {
            return this.astNode(this as any, object);
        }

        object.start = startLocation ?? null;
        object.end = endLocation ?? startLocation ?? null;

        return object;
    }

    private buildLocationFromToken(
        token: Token | number | null | undefined,
        { includeLineBreakCount = false, useStopIndex = false } = {}
    ): GameMakerAstLocation | null {
        if (!token) {
            return null;
        }

        let index: number | null;
        if (typeof token === "number") {
            index = token;
        } else {
            if (useStopIndex) {
                index =
                    typeof token.stopIndex === "number"
                        ? token.stopIndex
                        : typeof token.stop === "number"
                          ? token.stop
                          : null;

                if (index === null) {
                    index =
                        typeof token.startIndex === "number"
                            ? token.startIndex
                            : typeof token.start === "number"
                              ? token.start
                              : null;
                }
            } else {
                index =
                    typeof token.startIndex === "number"
                        ? token.startIndex
                        : typeof token.start === "number"
                          ? token.start
                          : typeof token.stopIndex === "number"
                            ? token.stopIndex
                            : typeof token.stop === "number"
                              ? token.stop
                              : null;
            }
        }

        if (index === null) {
            return null;
        }

        let line: number | null = null;
        if (typeof token !== "number") {
            line =
                typeof token.line === "number"
                    ? token.line + (includeLineBreakCount ? Core.getLineBreakCount(token.text ?? "") : 0)
                    : null;
        }

        return {
            line,
            index
        };
    }

    createIdentifierLocation(token: ParserToken): any {
        if (!token) {
            return null;
        }

        const startIndex =
            typeof token.start === "number"
                ? token.start
                : typeof token.startIndex === "number"
                  ? token.startIndex
                  : undefined;
        const stopIndex =
            typeof token.stop === "number"
                ? token.stop
                : typeof token.stopIndex === "number"
                  ? token.stopIndex
                  : startIndex;
        const line = typeof token.line === "number" ? token.line : undefined;
        const startColumn = typeof token.column === "number" ? token.column : undefined;

        const identifierLength =
            Number.isInteger(startIndex) && Number.isInteger(stopIndex) ? stopIndex - startIndex + 1 : undefined;

        const buildPoint = (index: number | undefined, column: number | undefined) => {
            if (typeof index !== "number") {
                return;
            }

            const point: { line?: number; index: number; column?: number } = {
                index
            };
            if (typeof line === "number") {
                point.line = line;
            }
            if (typeof column === "number") {
                point.column = column;
            }
            return point;
        };

        return {
            start: buildPoint(startIndex, startColumn),
            end: buildPoint(
                typeof stopIndex === "number" ? stopIndex + 1 : undefined,
                startColumn !== undefined && identifierLength !== undefined ? startColumn + identifierLength : undefined
            )
        };
    }

    visitBinaryExpression(ctx: ParserContext): any {
        return this.binaryExpressions.handle(ctx, {
            visit: (node: ParserContext) => this.visit(node),
            astNode: (context: ParserContext, value: any) => this.astNode(context, value)
        });
    }

    hasTrailingComma(commaList: any[], itemList: any[]): boolean {
        return commaList.length > 0 && commaList.length === itemList.length;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#program.
    build(ctx: ParserContext): any {
        const body = this.withScope("program", () => {
            // Accept null or undefined from the generated runtime for optional
            // productions.
            return ctx.statementList() === null ? [] : this.visit(this.ensureSingle(ctx.statementList()));
        });
        return this.astNode(ctx, {
            type: "Program",
            body: body ?? []
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#statementList.
    visitStatementList(ctx: ParserContext): any[] {
        const list: any[] = [];
        for (const statement of this.ensureArray(ctx.statement())) {
            const stmtObject = this.visit(statement);
            if (stmtObject === undefined) {
                continue;
            }
            list.push(stmtObject);
        }
        return list;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#statement.
    visitStatement(ctx: ParserContext): any {
        return this.visitFirstChild(ctx, [
            "block",
            "ifStatement",
            "variableDeclarationList",
            "implicitCallStatement",
            "assignmentExpression",
            "callStatement",
            "iterationStatement",
            "functionDeclaration",
            "switchStatement",
            "enumeratorDeclaration",
            "incDecStatement",
            "returnStatement",
            "exitStatement",
            "withStatement",
            "continueStatement",
            "breakStatement",
            "throwStatement",
            "tryStatement",
            "globalVarStatement",
            "macroStatement",
            "defineStatement",
            "regionStatement",
            "deleteStatement",
            "literalStatement",
            "identifierStatement",
            "malformedDocComment"
        ]);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#block.
    visitBlock(ctx: ParserContext): any {
        const body = ctx.statementList() ? this.visit(this.ensureSingle(ctx.statementList())) : [];
        return this.astNode(ctx, {
            type: "BlockStatement",
            body
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#ifStatement.
    visitIfStatement(ctx: ParserContext): any {
        const test = this.visit(this.ensureSingle(ctx.expression()));
        const stmtArr = this.ensureArray(ctx.statement());
        const consequent = this.visit(stmtArr[0]);
        const alternate = stmtArr.length > 1 ? this.visit(stmtArr[1]) : null;

        return this.astNode(ctx, {
            type: "IfStatement",
            test,
            consequent,
            alternate
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#DoStatement.
    visitDoStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "DoUntilStatement",
            body: this.visit(this.ensureSingle(ctx.statement())),
            test: this.visit(ctx.expression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#WhileStatement.
    visitWhileStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "WhileStatement",
            test: this.visit(this.ensureSingle(ctx.expression())),
            body: this.visit(this.ensureSingle(ctx.statement()))
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#ForStatement.
    visitForStatement(ctx: ParserContext): any {
        let init: any;
        let test: any;
        let update: any;
        let body: any;

        if (ctx.variableDeclarationList() !== null) {
            init = this.visit(ctx.variableDeclarationList());
        } else if (ctx.assignmentExpression() !== null) {
            init = this.visit(ctx.assignmentExpression());
        }
        if (ctx.expression() !== null) {
            test = this.visit(this.ensureSingle(ctx.expression()));
        }
        const forStatements = this.ensureArray(ctx.statement());
        if (forStatements.length > 1) {
            update = this.visit(forStatements[0]);
            body = this.visit(forStatements[1]);
        } else {
            body = this.visit(forStatements[0]);
        }

        return this.astNode(ctx, {
            type: "ForStatement",
            init,
            test,
            update,
            body
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#RepeatStatement.
    visitRepeatStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "RepeatStatement",
            test: this.visit(ctx.expression()),
            body: this.visit(this.ensureSingle(ctx.statement()))
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#withStatement.
    visitWithStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "WithStatement",
            test: this.visit(ctx.expression()),
            body: this.withScope("with", () => this.visit(this.ensureSingle(ctx.statement())))
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#switchStatement.
    visitSwitchStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "SwitchStatement",
            discriminant: this.visit(ctx.expression()),
            cases: this.visit(ctx.caseBlock())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#continueStatement.
    visitContinueStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "ContinueStatement"
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#breakStatement.
    visitBreakStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "BreakStatement"
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#exitStatement.
    visitExitStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "ExitStatement"
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#emptyStatement.
    visitEmptyStatement(ctx: ParserContext): any {
        return this.visitChildren(ctx);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#caseBlock.
    visitCaseBlock(ctx: ParserContext): any[] {
        const items: any[] = [];
        const children = Array.isArray((ctx as any).children) ? (ctx as any).children : [];
        for (const child of children) {
            // Skip tokens like '{', '}', 'begin', 'end'
            const text = typeof child.getText === "function" ? child.getText().toLowerCase() : "";
            if (["{", "}", "begin", "end"].includes(text)) {
                continue;
            }

            const visited = this.visit(child);
            if (visited !== null && visited !== undefined) {
                if (Array.isArray(visited)) {
                    items.push(...visited);
                } else {
                    items.push(visited);
                }
            }
        }
        return items;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#caseClauses.
    visitCaseClauses(ctx: ParserContext): any {
        return this.visitChildren(ctx);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#caseClause.
    visitCaseClause(ctx: ParserContext): any {
        const consequent = ctx.statementList() === null ? null : this.visit(ctx.statementList());
        return this.astNode(ctx, {
            type: "SwitchCase",
            test: this.visit(ctx.expression()),
            body: consequent
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#defaultClause.
    visitDefaultClause(ctx: ParserContext): any {
        const consequent = ctx.statementList() === null ? null : this.visit(ctx.statementList());
        return this.astNode(ctx, {
            type: "SwitchCase",
            test: null,
            body: consequent
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#throwStatement.
    visitThrowStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "ThrowStatement",
            argument: this.visit(ctx.expression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#tryStatement.
    visitTryStatement(ctx: ParserContext): any {
        const handler = ctx.catchProduction() === null ? null : this.visit(ctx.catchProduction());
        const finalizer = ctx.finallyProduction() === null ? null : this.visit(ctx.finallyProduction());
        return this.astNode(ctx, {
            type: "TryStatement",
            block: this.visit(ctx.statement()),
            handler,
            finalizer
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#catchProduction.
    visitCatchProduction(ctx: ParserContext): any {
        let param: any = null;
        const body = this.withScope("catch", () => {
            if (ctx.identifier() !== null) {
                param = this.withIdentifierRole({ type: "declaration", kind: "parameter" }, () =>
                    this.visit(this.ensureSingle(ctx.identifier()))
                );
            }
            return this.visit(ctx.statement());
        });
        return this.astNode(ctx, {
            type: "CatchClause",
            param,
            body
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#finallyProduction.
    visitFinallyProduction(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "Finalizer",
            body: this.visit(ctx.statement())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#returnStatement.
    visitReturnStatement(ctx: ParserContext): any {
        const returnExprCtx = this.ensureSingle(ctx.expression());
        const arg = returnExprCtx ? this.visit(returnExprCtx) : null;
        return this.astNode(ctx, {
            type: "ReturnStatement",
            argument: arg
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#deleteStatement.
    visitDeleteStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "DeleteStatement",
            operator: "delete",
            argument: this.visit(this.ensureSingle(ctx.expression()))
        });
    }

    visitLiteralStatement(ctx: ParserContext): any {
        if (!ctx) {
            return null;
        }

        const literalNode = this.ensureSingle(ctx.literal());
        let expression = this.visit(literalNode);

        if (typeof expression === "string") {
            expression = this.astNode(literalNode, {
                type: "Literal",
                value: expression
            });
        }

        if (!expression || typeof expression !== "object") {
            return null;
        }

        return this.astNode(ctx, {
            type: "ExpressionStatement",
            expression
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#assignmentExpression.
    visitAssignmentExpression(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "AssignmentExpression",
            operator: this.visit(ctx.assignmentOperator()),
            left: this.visit(ctx.lValueExpression()),
            right: this.visit(ctx.expressionOrFunction())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#variableDeclarationList.
    visitVariableDeclarationList(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "VariableDeclaration",
            declarations: this.visit(ctx.variableDeclaration()),
            kind: this.visit(ctx.varModifier())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#varModifier.
    visitVarModifier(ctx: ParserContext): string | undefined {
        if (this.ensureArray(ctx.Var()).length > 0) {
            return "var";
        }
        if (ctx.Static() !== null) {
            return "static";
        }
        return undefined;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#variableDeclaration.
    visitVariableDeclaration(ctx: ParserContext): any {
        const initExprCtx = this.ensureSingle(ctx.expressionOrFunction());
        const initExpr = initExprCtx ? this.visit(initExprCtx) : null;
        const id = this.withIdentifierRole({ type: "declaration", kind: "variable" }, () =>
            this.visit(this.ensureSingle(ctx.identifier()))
        );
        return this.astNode(ctx, {
            type: "VariableDeclarator",
            id,
            init: initExpr
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#globalVarStatement.
    visitGlobalVarStatement(ctx: ParserContext): any {
        const declarations = this.ensureArray(ctx.identifier())

            .map((identifierCtx: ParserContext) => {
                const identifier = this.withIdentifierRole(
                    {
                        type: "declaration",
                        kind: "variable",
                        tags: ["global"],
                        scopeOverride: GLOBAL_SCOPE_OVERRIDE_KEYWORD
                    },
                    () => this.visit(identifierCtx)
                );

                if (!identifier) {
                    return null;
                }

                this.scopeTracker?.markGlobalIdentifier(identifier);

                return this.astNode(identifierCtx, {
                    type: "VariableDeclarator",
                    id: identifier,
                    init: null
                });
            })
            .filter((declarator: any) => declarator !== null);

        if (declarations.length === 0) {
            return null;
        }

        return this.astNode(ctx, {
            type: "GlobalVarStatement",
            declarations,
            kind: "globalvar"
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#LValueExpression.
    visitLValueExpression(ctx: ParserContext): any {
        return this.buildLValueExpression(ctx);
    }

    buildLValueExpression(ctx: ParserContext): any {
        let object = this.visit(ctx.lValueStartExpression());

        // accumulate operations
        const ops = this.ensureArray(ctx.lValueChainOperator?.()) || [];
        for (const op of ops) {
            const node = this.visit(op);
            // The visitor contract allows individual rule handlers to return `null`
            // when they encounter malformed or otherwise-absent AST fragments (e.g.,
            // a parse error recovery path that skips a subtree). Attempting to assign
            // properties (like `.object = object`) to a null result would crash the
            // traversal with a TypeError. This guard filters out null nodes so the
            // chain accumulation can continue building partial AST structures, which
            // downstream consumers (the printer, Feather fix transforms, etc.) can
            // inspect without encountering partially-constructed or invalid subtrees.
            // Skipping null results here prevents cascading failures and enables the
            // parser to produce a "best-effort" AST even when the input contains
            // syntax errors or incomplete code fragments.
            if (node && typeof node === "object") {
                node.object = object;
                object = node;
            }
        }

        if (ctx.lValueFinalOperator() !== null) {
            const finalOp = this.visit(ctx.lValueFinalOperator());
            if (finalOp && typeof finalOp === "object") {
                finalOp.object = object;
                object = finalOp;
            }
        }

        return object;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#IdentifierLValue.
    visitIdentifierLValue(ctx: ParserContext): any {
        return this.visit(ctx.identifier());
    }

    // Visit a parse tree produced by GameMakerLanguageParser#NewLValue.
    visitNewLValue(ctx: ParserContext): any {
        return this.visit(ctx.newExpression());
    }

    // Visit a parse tree produced by GameMakerLanguageParser#ImplicitMemberDotLValue.
    visitImplicitMemberDotLValue(ctx: ParserContext): any {
        const memberDotLValueNode = this.visitMemberDotLValue(ctx);
        if (memberDotLValueNode === null) {
            return null;
        }

        return memberDotLValueNode;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#MemberIndexLValue.
    visitMemberIndexLValue(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "MemberIndexExpression",
            object: null,
            property: this.visit(ctx.expressionSequence()),
            accessor: this.visit(ctx.accessor())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#MemberDotLValue.
    visitMemberDotLValue(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "MemberDotExpression",
            object: null,
            property: this.withIdentifierRole({ type: "reference", kind: "property" }, () =>
                this.visit(ctx.identifier())
            )
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#CallLValue.
    visitCallLValue(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "CallExpression",
            object: null,
            arguments: this.visit(ctx.arguments())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#MemberIndexLValueFinal.
    visitMemberIndexLValueFinal(ctx: ParserContext): any {
        return this.visitFinalMemberLValue(ctx, "index");
    }

    // Visit a parse tree produced by GameMakerLanguageParser#MemberDotLValueFinal.
    visitMemberDotLValueFinal(ctx: ParserContext): any {
        return this.visitFinalMemberLValue(ctx, "dot");
    }

    visitFinalMemberLValue(ctx: ParserContext, memberKind: "index" | "dot"): any {
        if (memberKind === "index") {
            return this.visitMemberIndexLValue(ctx);
        }

        return this.visitMemberDotLValue(ctx);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#callableExpression.
    visitCallableExpression(ctx: ParserContext): any {
        return this.visitFirstChild(ctx, ["lValueExpression", "functionDeclaration", "callableExpression"]);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#expressionSequence.
    visitExpressionSequence(ctx: ParserContext): any[] {
        return this.ensureArray(ctx.expression()).map((expr: ParserContext) => this.visit(expr));
    }

    // Visit a parse tree produced by GameMakerLanguageParser#expressionOrFunction.
    visitExpressionOrFunction(ctx: ParserContext): any {
        return this.visitFirstChild(ctx, [
            "assignmentExpression",
            "expression",
            "functionDeclaration",
            "expressionOrFunction"
        ]);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#TernaryExpression.
    visitTernaryExpression(ctx: ParserContext): any {
        const expressions = this.ensureArray(ctx.expression());
        return this.astNode(ctx, {
            type: "TernaryExpression",
            test: this.visit(expressions[0] ?? null),
            consequent: this.visit(expressions[1] ?? null),
            alternate: this.visit(expressions[2] ?? null)
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#NotExpression.
    visitNotExpression(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "UnaryExpression",
            operator: "!",
            prefix: true,
            argument: this.visit(ctx.expression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#UnaryPlusExpression.
    visitUnaryPlusExpression(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "UnaryExpression",
            operator: "+",
            prefix: true,
            argument: this.visit(ctx.expression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#UnaryMinusExpression.
    visitUnaryMinusExpression(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "UnaryExpression",
            operator: "-",
            prefix: true,
            argument: this.visit(ctx.expression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#CallExpression.
    visitCallExpression(ctx: ParserContext): any {
        return this.visit(ctx.callStatement());
    }

    // Visit a parse tree produced by GameMakerLanguageParser#FunctionExpression.
    visitFunctionExpression(ctx: ParserContext): any {
        return this.visit(ctx.functionDeclaration());
    }

    // Visit a parse tree produced by GameMakerLanguageParser#StructLiteralLValue.
    visitStructLiteralLValue(ctx: ParserContext): any {
        return this.visit(ctx.structLiteral());
    }

    // Visit a parse tree produced by GameMakerLanguageParser#ParenthesizedLValue.
    visitParenthesizedLValue(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "ParenthesizedExpression",
            expression: this.visit(ctx.expression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#incDecStatement.
    visitIncDecStatement(ctx: ParserContext): any {
        const incDecExpressionContext = ctx.preIncDecExpression() ?? ctx.postIncDecExpression();
        if (incDecExpressionContext !== null) {
            const result = this.visit(incDecExpressionContext);
            // The ANTLR grammar models `++i;` and `i++;` statements by reusing
            // expression visitor branches, so re-tag the result as a statement.
            result.type = "IncDecStatement";
            return result;
        }

        return null;
    }

    visitIncDecExpression(ctx: ParserContext): any {
        if (ctx.preIncDecExpression()) {
            return this.visit(ctx.preIncDecExpression());
        } else if (ctx.postIncDecExpression()) {
            return this.visit(ctx.postIncDecExpression());
        }
        return undefined;
    }

    _getIncDecOperator(ctx: ParserContext): string | null {
        if (this.ensureToken(ctx.PlusPlus()) !== null) {
            return this.ensureToken(ctx.PlusPlus()).getText();
        }
        if (this.ensureToken(ctx.MinusMinus()) !== null) {
            return this.ensureToken(ctx.MinusMinus()).getText();
        }
        return null;
    }

    _createIncDecNode(ctx: ParserContext, type: string, prefix: boolean): any {
        return this.astNode(ctx, {
            type,
            operator: this._getIncDecOperator(ctx),
            prefix,
            argument: this.visit(ctx.lValueExpression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#PostIncDecExpression.
    visitPostIncDecExpression(ctx: ParserContext): any {
        return this._createIncDecNode(ctx, "IncDecExpression", false);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#PostIncDecStatement.
    visitPostIncDecStatement(ctx: ParserContext): any {
        return this._createIncDecNode(ctx, "IncDecStatement", false);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#PreIncDecStatement.
    visitPreIncDecStatement(ctx: ParserContext): any {
        return this._createIncDecNode(ctx, "IncDecStatement", true);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#PreIncDecExpression.
    visitPreIncDecExpression(ctx: ParserContext): any {
        return this._createIncDecNode(ctx, "IncDecExpression", true);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#BitNotExpression.
    visitBitNotExpression(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "UnaryExpression",
            operator: "~",
            prefix: true,
            argument: this.visit(ctx.expression())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#NewExpression.
    visitNewExpression(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "NewExpression",
            expression: this.withIdentifierRole({ type: "reference", kind: "type" }, () =>
                this.visit(ctx.identifier())
            ),
            arguments: this.visit(ctx.arguments())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#LiteralExpression.
    visitLiteralExpression(ctx: ParserContext): any {
        return this.visitChildren(ctx)[0];
    }

    // Visit a parse tree produced by GameMakerLanguageParser#MemberDotExpression.
    visitMemberDotExpression(ctx: ParserContext): any {
        const object = this.visit(ctx.expression()[0]);
        const property = this.withIdentifierRole({ type: "reference", kind: "property" }, () =>
            this.visit(ctx.expression()[1])
        );
        const node: any = this.astNode(ctx, {
            type: "MemberDotExpression",
            object,
            property
        });

        if (object?.start && typeof object.start.index === "number") {
            node.start = node.start || {};
            node.start.index = object.start.index;
            if (typeof object.start.line === "number") {
                node.start.line = object.start.line;
            }
        }

        return node;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#MemberIndexExpression.
    visitMemberIndexExpression(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "MemberIndexExpression",
            object: this.visit(ctx.expression()),
            property: this.visit(ctx.expressionSequence()),
            accessor: this.visit(ctx.accessor())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#VariableExpression.
    visitVariableExpression(ctx: ParserContext): any {
        return this.visit(ctx.lValueExpression());
    }

    // Visit a parse tree produced by GameMakerLanguageParser#callStatement.
    visitCallStatement(ctx: ParserContext): any {
        const object = this.resolveCallStatementObject(ctx);

        return this.astNode(ctx, {
            type: "CallExpression",
            object,
            arguments: this.visit(ctx.arguments())
        });
    }

    resolveCallStatementObject(ctx: ParserContext): any {
        const nestedCallStatement = ctx.callStatement();
        if (nestedCallStatement === null) {
            const callableExpression = ctx.callableExpression();
            if (callableExpression === null) {
                return null;
            }

            return this.visit(callableExpression);
        }

        return this.visit(nestedCallStatement);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#implicitCallStatement.
    visitImplicitCallStatement(ctx: ParserContext): any {
        const object =
            ctx.implicitCallStatement() == null
                ? this.astNode(ctx, {
                      type: "MemberDotExpression",
                      object: null,
                      property: this.withIdentifierRole({ type: "reference", kind: "property" }, () =>
                          this.visit(ctx.identifier())
                      )
                  })
                : this.visit(ctx.implicitCallStatement());

        return this.astNode(ctx, {
            type: "CallExpression",
            object,
            arguments: this.visit(ctx.arguments())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#accessor.
    visitAccessor(ctx: ParserContext): string {
        return this.ensureToken(ctx).getText();
    }

    // Visit a parse tree produced by GameMakerLanguageParser#arguments.
    visitArguments(ctx: ParserContext): any[] {
        const argList: any[] = [];
        const argumentListCtx = this.ensureSingle(ctx.argumentList());
        if (argumentListCtx) {
            const children = argumentListCtx.children;
            const hasLeadingComma =
                Array.isArray(children) &&
                children.length > 0 &&
                typeof children[0]?.getText === "function" &&
                children[0].getText() === ",";

            this.collectArguments(argumentListCtx, argList);

            if (hasLeadingComma) {
                // Use the first comma token for location of the leading missing argument
                const commaToken = children[0];
                argList.unshift(
                    this.astNodeFromToken(commaToken, {
                        type: "MissingOptionalArgument"
                    })
                );
            }
        }
        // check if trailingComma exists
        const trailingCommaCtx = this.ensureSingle(ctx.trailingComma());
        if (trailingCommaCtx) {
            // Use the trailing comma context for location of the trailing missing argument
            argList.push(
                this.astNode(trailingCommaCtx, {
                    type: "MissingOptionalArgument"
                })
            );
        }
        return argList;
    }

    // Helper function to collect arguments recursively from an argumentList
    collectArguments(ctx: ParserContext, argList: any[]): void {
        const args = this.ensureArray(ctx.argument());
        for (const arg of args) {
            if (arg.UndefinedLiteral()) {
                argList.push(this.visit(arg));
            } else if (!arg.expressionOrFunction()) {
                argList.push(
                    this.astNode(arg, {
                        type: "MissingOptionalArgument"
                    })
                );
            } else if (arg.expressionOrFunction()) {
                argList.push(this.visit(arg.expressionOrFunction()));
            }
        }
    }

    // Visit a parse tree produced by GameMakerLanguageParser#assignmentOperator.
    visitAssignmentOperator(ctx: ParserContext): string {
        let text = this.ensureToken(ctx).getText();
        if (text === ":=") {
            text = "=";
        }
        return text;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#literal.
    visitLiteral(ctx: ParserContext): any {
        if (ctx.arrayLiteral() != null) {
            return this.visit(ctx.arrayLiteral());
        }
        if (ctx.structLiteral() != null) {
            return this.visit(ctx.structLiteral());
        }
        if (ctx.templateStringLiteral() != null) {
            return this.visit(ctx.templateStringLiteral());
        }
        if (ctx.HexIntegerLiteral() != null || ctx.BinaryLiteral() != null) {
            return this.astNode(ctx, {
                type: "Literal",
                value: this.ensureToken(ctx).getText()
            });
        }

        const value = this.ensureToken(ctx).getText();

        return this.astNode(ctx, {
            type: "Literal",
            value
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#templateStringLiteral.
    visitTemplateStringLiteral(ctx: ParserContext): any {
        const atoms = this.ensureArray(ctx.templateStringAtom());
        const atomList: any[] = [];

        for (const atom of atoms) {
            if (atom.expression() != null) {
                atomList.push(this.visit(atom.expression()));
            }
            if (atom.TemplateStringText() != null) {
                const templateText = this.ensureToken(atom.TemplateStringText());
                const value = templateText?.getText() ?? "";
                const symbol = (templateText as any)?.symbol;

                atomList.push({
                    type: "TemplateStringText",
                    value,
                    start: {
                        line: symbol?.line ?? 0,
                        index: symbol?.start ?? 0
                    },
                    end: {
                        line: (symbol?.line ?? 0) + Core.getLineBreakCount(value),
                        index: symbol?.stop ?? symbol?.start ?? 0
                    }
                });
            }
        }

        return this.astNode(ctx, {
            type: "TemplateStringExpression",
            atoms: atomList
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#templateStringAtom.
    visitTemplateStringAtom(ctx: ParserContext): void {
        this.visitChildren(ctx);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#arrayLiteral.
    visitArrayLiteral(ctx: ParserContext): any {
        const elemList = this.ensureSingle(ctx.elementList());
        const hasTrailingComma = this.hasTrailingComma(
            this.ensureArray(elemList?.Comma()),
            this.ensureArray(elemList?.expressionOrFunction())
        );
        return this.astNode(ctx, {
            type: "ArrayExpression",
            elements: this.visit(elemList),
            hasTrailingComma
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#elementList.
    visitElementList(ctx: ParserContext): any[] {
        // Accept both `undefined` and `null` as absent children from the
        // generated parser runtime. The runtime sometimes returns `null` for
        // missing optional productions, so use a nullish check here.
        if (this.ensureArray(ctx.expressionOrFunction()).length === 0) {
            return [];
        }
        return this.visit(this.ensureArray(ctx.expressionOrFunction()));
    }

    // Visit a parse tree produced by GameMakerLanguageParser#structLiteral.
    visitStructLiteral(ctx: ParserContext): any {
        const structItems = this.ensureArray(ctx.structItem());
        const properties = structItems.length > 0 ? this.visit(structItems) : [];
        const hasTrailingComma = this.hasTrailingComma(this.ensureArray(ctx.Comma()), structItems);
        return this.astNode(ctx, {
            type: "StructExpression",
            properties,
            hasTrailingComma
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#structItem.
    visitStructItem(ctx: ParserContext): any {
        return this.visitFirstChild(ctx, ["propertyAssignment", "regionStatement", "macroStatement"]);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#functionDeclaration.
    visitFunctionDeclaration(ctx: ParserContext): any {
        let id: string | null = null;
        let idLocation: any = null;

        // Guard against `null` as well as `undefined` from the parser runtime.
        if (this.ensureToken(ctx.Identifier()) != null) {
            const identifierNode = this.ensureToken(ctx.Identifier());
            id = identifierNode.getText();
            idLocation = this.createIdentifierLocation((identifierNode as any).symbol);
        }

        const paramListCtx = this.ensureSingle(ctx.parameterList());

        let params: any[] = [];

        const hasTrailingComma = paramListCtx
            ? this.hasTrailingComma(
                  this.ensureArray(paramListCtx.Comma()),
                  this.ensureArray(paramListCtx.parameterArgument())
              )
            : false;

        const body = this.withScope("function", () => {
            if (paramListCtx != null) {
                const p = this.visit(paramListCtx);
                params = p ? Core.toArray(p) : [];
            }
            return this.visit(ctx.block());
        });

        // constructorClause may be nullish; accept null and undefined.
        if (ctx.constructorClause() != null) {
            return this.astNode(ctx, {
                type: "ConstructorDeclaration",
                id,
                idLocation,
                params,
                parent: this.visit(ctx.constructorClause()),
                body,
                hasTrailingComma
            });
        }

        return this.astNode(ctx, {
            type: "FunctionDeclaration",
            id,
            idLocation,
            params,
            body,
            hasTrailingComma
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#constructorClause.
    visitConstructorClause(ctx: ParserContext): any {
        let id: string | null = null;
        let idLocation = null;
        let params: any[] = [];
        let hasTrailingComma = false;

        if (ctx.Identifier() != null) {
            const identifierNode = this.ensureSingle(ctx.Identifier());
            const identifierToken = this.ensureToken(identifierNode);
            id = identifierToken.getText();
            idLocation = this.createIdentifierLocation(
                Core.isObjectLike(identifierNode) && "symbol" in identifierNode
                    ? ((identifierNode as { symbol?: ParserToken }).symbol ?? identifierToken)
                    : identifierToken
            );
        }

        const argsCtx = this.ensureSingle(ctx.arguments?.());
        if (argsCtx != null) {
            params = this.visit(argsCtx);
            hasTrailingComma = Boolean(this.ensureSingle(argsCtx.trailingComma()));

            if (hasTrailingComma && params.length > 0) {
                const lastParam = params.at(-1);
                if (lastParam?.type === "MissingOptionalArgument") {
                    params = params.slice(0, -1);
                }
            }
        }

        if (!id && params.length === 0) {
            return null;
        }

        return this.astNode(ctx, {
            type: "ConstructorParentClause",
            id,
            idLocation,
            params,
            hasTrailingComma
        });
    }

    visitInheritanceClause(ctx: ParserContext): any {
        const id = this.withIdentifierRole({ type: "reference", kind: "type" }, () => this.visit(ctx.identifier()));
        const args = ctx.arguments() ? this.visit(ctx.arguments()) : [];

        return this.astNode(ctx, {
            type: "InheritanceClause",
            id,
            arguments: args
        });
    }

    visitStructDeclaration(ctx: ParserContext): any {
        const id = this.withIdentifierRole({ type: "declaration", kind: "struct" }, () => this.visit(ctx.identifier()));
        const paramListCtx = this.ensureSingle(ctx.parameterList());
        let params: any[] = [];
        const body = this.withScope("struct", () => {
            if (paramListCtx != null) {
                params = this.visit(paramListCtx);
            }
            return this.visit(ctx.block());
        });
        const parent = ctx.inheritanceClause() ? this.visit(ctx.inheritanceClause()) : null;

        return this.astNode(ctx, {
            type: "StructDeclaration",
            id,
            params,
            body,
            parent
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#parameterList.
    visitParameterList(ctx: ParserContext): any[] {
        const params = this.ensureArray(ctx.parameterArgument());
        const paramList: any[] = [];
        for (const param of params) {
            paramList.push(this.visit(param));
        }
        return paramList;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#parameterArgument.
    visitParameterArgument(ctx: ParserContext): any {
        const identifier = () =>
            this.withIdentifierRole({ type: "declaration", kind: "parameter" }, () => this.visit(ctx.identifier()));

        if (ctx.expressionOrFunction() === undefined) {
            return identifier();
        }

        return this.astNode(ctx, {
            type: "DefaultParameter",
            left: identifier(),
            right: this.visit(ctx.expressionOrFunction())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#propertyAssignment.
    visitPropertyAssignment(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "Property",
            name: this.visit(ctx.propertyIdentifier()),
            value: this.visit(ctx.expressionOrFunction())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#propertyIdentifier.
    visitPropertyIdentifier(ctx: ParserContext): string {
        return this.ensureToken(ctx).getText();
    }

    // Visit a parse tree produced by GameMakerLanguageParser#identifier.
    visitIdentifier(ctx: ParserContext): any {
        const name = this.ensureToken(ctx).getText();
        const node: any = this.astNode(ctx, {
            type: "Identifier",
            name
        });
        this.scopeTracker?.applyGlobalIdentifiersToNode(node);
        this.scopeTracker?.applyCurrentRoleToIdentifier(name, node);
        return node;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#enumeratorDeclaration.
    visitEnumeratorDeclaration(ctx: ParserContext): any {
        const name = this.withIdentifierRole({ type: "declaration", kind: "enum" }, () => this.visit(ctx.identifier()));
        return this.astNode(ctx, {
            type: "EnumDeclaration",
            name,
            members: this.visit(ctx.enumeratorList()),
            hasTrailingComma: this.ensureArray(this.ensureSingle(ctx.enumeratorList())?.Comma()).length > 0
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#enumeratorList.
    visitEnumeratorList(ctx: ParserContext): any {
        return this.visit(this.ensureArray(ctx.enumeratorItem()));
    }

    // Visit a parse tree produced by GameMakerLanguageParser#enumeratorItem.
    visitEnumeratorItem(ctx: ParserContext): any {
        return this.visitFirstChild(ctx, ["enumerator", "regionStatement", "macroStatement"]);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#enumerator.
    visitEnumerator(ctx: ParserContext): any {
        let initializer: any = null;

        if (typeof ctx.expression === "function") {
            const expressionContext = this.ensureSingle(ctx.expression());
            if (expressionContext) {
                initializer = this.visit(expressionContext);
                initializer = this.normalizeEnumInitializer(initializer, expressionContext);
            }
        }

        if (initializer == null && typeof ctx.IntegerLiteral === "function") {
            const literal = this.ensureToken(ctx.IntegerLiteral());
            if (literal) {
                initializer = literal?.getText();
            }
        }
        if (initializer == null && typeof ctx.HexIntegerLiteral === "function") {
            const literal = this.ensureToken(ctx.HexIntegerLiteral());
            if (literal) {
                initializer = literal?.getText();
            }
        }
        if (initializer == null && typeof ctx.BinaryLiteral === "function") {
            const literal = this.ensureToken(ctx.BinaryLiteral());
            if (literal) {
                initializer = literal?.getText();
            }
        }

        return this.astNode(ctx, {
            type: "EnumMember",
            name: this.withIdentifierRole({ type: "declaration", kind: "enum-member" }, () =>
                this.visit(ctx.identifier())
            ),
            initializer
        });
    }

    private normalizeEnumInitializer(initializer: any, expressionContext: ParserContext | null): any {
        if (!expressionContext || !initializer || typeof initializer !== "object") {
            return initializer;
        }

        if (initializer.type === "Literal") {
            return initializer.value;
        }

        const initializerText = this.ensureToken(expressionContext)?.getText();
        if (typeof initializerText === "string") {
            initializer._enumInitializerText = initializerText.trim();
        }

        return initializer;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#macroStatement.
    visitMacroStatement(ctx: ParserContext): any {
        const name = this.withIdentifierRole(
            {
                type: "declaration",
                kind: "macro",
                tags: ["global"],
                scopeOverride: GLOBAL_SCOPE_OVERRIDE_KEYWORD
            },
            () => this.visit(ctx.identifier())
        );
        return this.astNode(ctx, {
            type: "MacroDeclaration",
            name,
            tokens: this.visit(ctx.macroToken()),
            keyword: "macro",
            keywordRange: this.buildDirectiveKeywordRange(ctx?.start, "macro")
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#macroStatement.
    visitMacroToken(ctx: ParserContext): string {
        return this.ensureToken(ctx).getText();
    }

    // Visit a parse tree produced by GameMakerLanguageParser#defineStatement.
    visitDefineStatement(ctx: ParserContext): any {
        const defineKeywordRange = this.buildDirectiveKeywordRange(ctx?.start, "define");
        const regionCharactersNode = this.ensureSingle(ctx.RegionCharacters());
        const regionCharactersToken = this.resolveParserToken(regionCharactersNode);
        const regionCharacters = this.ensureToken(ctx.RegionCharacters());
        const rawText = regionCharacters ? regionCharacters.getText() : "";
        const trimmed = Core.getNonEmptyTrimmedString(rawText);

        if (!trimmed) {
            return null;
        }

        const regionMatch = rawText.match(/^\s*region\b(.*)$/i);
        if (regionMatch) {
            return this.astNode(ctx, {
                type: "DefineStatement",
                name: rawText,
                replacementDirective: "#region",
                replacementSuffix: regionMatch[1] ?? ""
            });
        }

        const endRegionMatch = rawText.match(/^\s*(?:end\s*region|endregion)\b(.*)$/i);
        if (endRegionMatch) {
            return this.astNode(ctx, {
                type: "DefineStatement",
                name: rawText,
                replacementDirective: "#endregion",
                replacementSuffix: endRegionMatch[1] ?? ""
            });
        }

        const parsedMacroDirective = this.parseDefineMacroDirective(rawText);
        if (parsedMacroDirective) {
            const macroIdentifier = this.withIdentifierRole(
                {
                    type: "declaration",
                    kind: "macro",
                    tags: ["global"],
                    scopeOverride: GLOBAL_SCOPE_OVERRIDE_KEYWORD
                },
                () => this.createDefineMacroIdentifierNode(parsedMacroDirective, regionCharactersToken)
            );
            return this.astNode(ctx, {
                type: "MacroDeclaration",
                name: macroIdentifier,
                tokens: parsedMacroDirective.macroValue.length > 0 ? [parsedMacroDirective.macroValue] : [],
                keyword: "define",
                keywordRange: defineKeywordRange
            });
        }

        return null;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#regionStatement.
    visitRegionStatement(ctx: ParserContext): any {
        let name: string | null = null;
        const regionChars = this.ensureToken(ctx.RegionCharacters());
        if (regionChars != null) {
            name = regionChars.getText();
        }
        return ctx.EndRegion()
            ? this.astNode(ctx, {
                  type: "EndRegionStatement",
                  name
              })
            : this.astNode(ctx, {
                  type: "RegionStatement",
                  name
              });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#identifierStatement.
    visitIdentifierStatement(ctx: ParserContext): any {
        return this.astNode(ctx, {
            type: "IdentifierStatement",
            name: this.visit(ctx.identifier())
        });
    }

    // Visit a parse tree produced by GameMakerLanguageParser#keyword.
    visitKeyword(ctx: ParserContext): any {
        return this.visitChildren(ctx);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#softKeyword.
    visitSoftKeyword(ctx: ParserContext): string | null {
        if (ctx.Constructor() != null) {
            return this.ensureToken(ctx.Constructor()).getText();
        }
        return null;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#propertySoftKeyword.
    visitPropertySoftKeyword(ctx: ParserContext): string | undefined {
        if (ctx.NoOneLiteral() != null) {
            return this.ensureToken(ctx.NoOneLiteral()).getText();
        }
        return undefined;
    }

    // Visit a parse tree produced by GameMakerLanguageParser#openBlock.
    visitOpenBlock(ctx: ParserContext): any {
        return this.visitChildren(ctx);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#closeBlock.
    visitCloseBlock(ctx: ParserContext): any {
        return this.visitChildren(ctx);
    }

    // Visit a parse tree produced by GameMakerLanguageParser#eos.
    visitEos(ctx: ParserContext): any {
        return this.visitChildren(ctx);
    }
}
