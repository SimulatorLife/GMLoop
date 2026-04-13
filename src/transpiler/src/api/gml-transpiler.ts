import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import {
    type CallTargetAnalyzer,
    collectLocalVariables,
    createSemanticOracle,
    type EmitOptions,
    ensureStatementTerminated,
    type FunctionDeclarationNode,
    GmlToJsEmitter,
    type IdentifierAnalyzer,
    type ProgramNode
} from "../emitter/index.js";
import { EventContextOracle } from "../event-context/index.js";

export interface TranspileScriptRequest {
    /**
     * Absolute or workspace-relative file path that produced the source.
     * This is surfaced in patch metadata for runtime diagnostics.
     */
    readonly sourcePath?: string;
    readonly sourceText: string;
    readonly symbolId: string;
    /**
     * Pre-parsed AST to reuse instead of parsing sourceText again.
     * When provided, parsing is skipped and this AST is used directly.
     * This eliminates redundant parsing when the caller has already parsed the source.
     */
    readonly ast?: unknown;
}

export interface TranspileEventRequest {
    /**
     * Absolute or workspace-relative file path that produced the source.
     * Surfaced in patch metadata for runtime diagnostics.
     */
    readonly sourcePath?: string;
    readonly sourceText: string;
    readonly symbolId: string;
    /**
     * Pre-parsed AST to reuse instead of re-parsing `sourceText`.
     * Eliminates redundant parsing when the caller already has the AST.
     */
    readonly ast?: unknown;
    /**
     * Name to use as the `this` binding in the emitted patch.
     * Defaults to `"self"` when not provided.
     */
    readonly thisName?: string;
}

export interface PatchMetadata {
    readonly timestamp: number;
    readonly sourcePath?: string;
    readonly dependencies?: Array<string>;
}

export interface ScriptPatch {
    readonly kind: "script";
    readonly id: string;
    readonly js_body: string;
    readonly sourceText: string;
    readonly version: number;
    readonly metadata?: PatchMetadata;
}

export interface EventPatch {
    readonly kind: "event";
    readonly id: string;
    readonly js_body: string;
    readonly sourceText: string;
    readonly version: number;
    /**
     * The name used as the `this` binding for the event body.
     * Always `"self"` in standard GameMaker HTML5 export code.
     */
    readonly this_name: string;
    readonly metadata?: PatchMetadata;
}

/**
 * A hot-reload patch for a GML closure (anonymous or named nested function).
 *
 * Closures are registered in the runtime wrapper's closure registry and
 * created via `new Function("...args", js_body)`. The emitted `js_body`
 * unpacks named parameters from the `args` array (identical to the script
 * unwrapping pattern used by `ScriptPatch`) so that callers can invoke the
 * function by passing positional arguments.
 *
 * The runtime-wrapper's `ClosurePatch` interface is intentionally compatible:
 * this type carries additional transpiler metadata (`sourceText`, `version`)
 * but remains structurally assignable to the runtime type.
 */
export interface ClosurePatch {
    readonly kind: "closure";
    readonly id: string;
    readonly js_body: string;
    readonly sourceText: string;
    readonly version: number;
    readonly metadata?: PatchMetadata;
}

/**
 * Request object for `GmlTranspiler.transpileClosure`.
 */
export interface TranspileClosureRequest {
    /**
     * Absolute or workspace-relative file path that produced the source.
     * Surfaced in patch metadata for runtime diagnostics.
     */
    readonly sourcePath?: string;
    readonly sourceText: string;
    readonly symbolId: string;
    /**
     * Pre-parsed AST to reuse instead of re-parsing `sourceText`.
     * Eliminates redundant parsing when the caller already has the AST.
     */
    readonly ast?: unknown;
}

export interface TranspilerDependencies {
    readonly semantic?: IdentifierAnalyzer & CallTargetAnalyzer;
    readonly emitterOptions?: Partial<EmitOptions>;
}

export class GmlTranspiler {
    private readonly semantic?: IdentifierAnalyzer & CallTargetAnalyzer;
    private readonly emitterOptions?: Partial<EmitOptions>;
    private readonly fallbackSemantic: IdentifierAnalyzer & CallTargetAnalyzer;

    constructor(dependencies: TranspilerDependencies = {}) {
        this.semantic = dependencies.semantic;
        this.emitterOptions = dependencies.emitterOptions;
        this.fallbackSemantic = createSemanticOracle();
    }

    private getSemanticAnalyzers(): IdentifierAnalyzer & CallTargetAnalyzer {
        return this.semantic ?? this.fallbackSemantic;
    }

    private parseProgram(sourceText: string) {
        const parser = new Parser.GMLParser(sourceText, {});
        return parser.parse();
    }

    private resolveProgramAst(request: TranspileScriptRequest | TranspileEventRequest): ProgramNode {
        const astCandidate = request.ast ?? this.parseProgram(request.sourceText);
        if (!Core.isObjectLike(astCandidate)) {
            throw new TypeError("transpile request requires ast to be a Program-like object when provided");
        }

        const astRecord = astCandidate as Record<string, unknown>;
        if (astRecord.type !== "Program") {
            throw new TypeError("transpile request requires ast.type to be 'Program' when ast is provided");
        }
        if (!Array.isArray(astRecord.body)) {
            throw new TypeError("transpile request requires ast.body to be an array when ast is provided");
        }

        return astCandidate as ProgramNode;
    }

    private emitFunctionParameterUnpacking(func: FunctionDeclarationNode, emitter: GmlToJsEmitter): string {
        const lines: string[] = [];

        for (let index = 0; index < func.params.length; index += 1) {
            const parameter = func.params[index];
            let line = "";

            if (typeof parameter === "string") {
                line = `var ${parameter} = args[${index}];`;
            } else if (parameter.type === "Identifier") {
                line = `var ${parameter.name} = args[${index}];`;
            } else if (parameter.type === "DefaultParameter" && parameter.left.type === "Identifier") {
                const name = parameter.left.name;
                if (parameter.right) {
                    const defaultValue = emitter.emit(parameter.right);
                    line = `var ${name} = args[${index}] === undefined ? ${defaultValue} : args[${index}];`;
                } else {
                    line = `var ${name} = args[${index}];`;
                }
            }

            if (!line) {
                continue;
            }

            lines.push(line);
        }

        return lines.join("\n");
    }

    private emitUnwrappedFunctionBody(body: ProgramNode["body"][number], emitter: GmlToJsEmitter): string {
        if (body.type !== "BlockStatement") {
            return emitter.emit(body).trim();
        }

        const lines: string[] = [];
        for (const statement of body.body) {
            const code = emitter.emit(statement);
            if (!code) {
                continue;
            }

            lines.push(ensureStatementTerminated(code));
        }

        return lines.join("\n");
    }

    private createTranspileError(contextLabel: string, error: unknown): Error {
        const cause = Core.isErrorLike(error) ? error : undefined;
        const causeMessage =
            cause && "message" in cause && typeof cause.message === "string" ? cause.message : undefined;
        const message = causeMessage ?? (Core.isNonEmptyString(error) ? error : "Unknown transpilation error");
        return new Error(`Failed to transpile ${contextLabel}: ${message}`, {
            cause
        });
    }

    /**
     * Build patch metadata from optional source path and an emitter's collected
     * script-reference set.
     *
     * `dependencies` is omitted from the metadata when the emitter encountered
     * no script calls, keeping the patch object lean for simple event bodies
     * and library utilities that never invoke other scripts.
     */
    private buildPatchMetadata(
        sourcePath: string | undefined,
        emitter: GmlToJsEmitter,
        timestamp: number
    ): PatchMetadata {
        const deps = emitter.getDependencies();
        return {
            ...(sourcePath ? { sourcePath } : {}),
            ...(deps.size > 0 ? { dependencies: [...deps] } : {}),
            timestamp
        };
    }

    /**
     * Returns the single `FunctionDeclaration` node from a program if the program
     * contains exactly one statement of that type, otherwise returns `null`.
     *
     * Centralizes the narrowing logic shared by `transpileScript` and
     * `transpileClosure`, eliminating the need for unsafe double casts at
     * each call site.
     */
    private extractSingleFunctionDeclaration(ast: ProgramNode): FunctionDeclarationNode | null {
        if (ast.body.length !== 1) {
            return null;
        }
        const firstNode = ast.body[0];
        if (firstNode.type !== "FunctionDeclaration") {
            return null;
        }
        // TypeScript narrows `firstNode` to `FunctionDeclarationNode` here because
        // we've already ruled out `firstNode.type !== "FunctionDeclaration"` above,
        // and the `GmlNode` union is discriminated on `.type`.
        return firstNode;
    }

    transpileScript(request: TranspileScriptRequest): ScriptPatch {
        if (!request || typeof request !== "object") {
            throw new TypeError("transpileScript requires a request object");
        }
        const { sourceText, symbolId } = request;
        const sourcePath = request.sourcePath;
        if (typeof sourceText !== "string" || sourceText.length === 0) {
            throw new TypeError("transpileScript requires a sourceText string");
        }
        if (typeof symbolId !== "string" || symbolId.length === 0) {
            throw new TypeError("transpileScript requires a symbolId string");
        }
        if (sourcePath !== undefined && (typeof sourcePath !== "string" || sourcePath.length === 0)) {
            throw new TypeError("transpileScript requires sourcePath to be a non-empty string when provided");
        }

        try {
            const ast = this.resolveProgramAst(request);
            const emitter = new GmlToJsEmitter(this.getSemanticAnalyzers(), this.emitterOptions);
            let jsBody = "";

            // Special handling for GML 2.3+ scripts that contain a single function declaration.
            // When hot-reloading, we want to execute the function body immediately when the patch is applied,
            // rather than just defining the function in the local scope.
            // We unwrap the function, generating code to unpack 'args' into the named parameters,
            // and then emit the body of the function.
            const singleFunc = this.extractSingleFunctionDeclaration(ast);
            if (singleFunc === null) {
                jsBody = emitter.emit(ast);
            } else {
                const paramUnpacking = this.emitFunctionParameterUnpacking(singleFunc, emitter);
                const bodyContent = this.emitUnwrappedFunctionBody(singleFunc.body, emitter);

                jsBody = paramUnpacking ? `${paramUnpacking}\n${bodyContent}` : bodyContent;
            }

            const timestamp = Date.now();
            const patch: ScriptPatch = {
                kind: "script",
                id: symbolId,
                js_body: jsBody,
                sourceText,
                version: timestamp,
                metadata: this.buildPatchMetadata(sourcePath, emitter, timestamp)
            };
            return patch;
        } catch (error) {
            throw this.createTranspileError(`script ${symbolId}`, error);
        }
    }

    transpileExpression(sourceText: string): string {
        if (typeof sourceText !== "string" || sourceText.length === 0) {
            throw new TypeError("transpileExpression requires a sourceText string");
        }

        try {
            const parser = new Parser.GMLParser(sourceText);
            const ast = parser.parse();
            const emitter = new GmlToJsEmitter(this.getSemanticAnalyzers(), this.emitterOptions);
            return emitter.emit(ast);
        } catch (error) {
            throw this.createTranspileError("expression", error);
        }
    }

    /**
     * Transpile a GML object event body into an `EventPatch`.
     *
     * Object events in GameMaker are plain statement sequences (no wrapping
     * function declaration) that execute in the context of a specific object
     * instance. Identifier resolution follows these rules:
     *
     *   - `var`-declared names in the event body → local variables (bare JS names)
     *   - All other undeclared identifiers → instance fields (emitted as `self.<name>`)
     *   - Built-in functions (abs, sqrt, etc.) → emitted as bare calls
     *   - Known scripts → routed through the hot-reload runtime wrapper
     *
     * @example
     * ```typescript
     * const patch = transpiler.transpileEvent({
     *   sourceText: "var spd = 5; x += spd; health -= 1;",
     *   symbolId: "gml/event/obj_player/create"
     * });
     * // patch.js_body ≈ "var spd = 5; x += spd; self.health -= 1;"
     * //                              ^^^^ local   ^^^^^^^^^^^^ self field
     * ```
     */
    transpileEvent(request: TranspileEventRequest): EventPatch {
        if (!request || typeof request !== "object") {
            throw new TypeError("transpileEvent requires a request object");
        }
        const { sourceText, symbolId } = request;
        const sourcePath = request.sourcePath;
        if (typeof sourceText !== "string" || sourceText.length === 0) {
            throw new TypeError("transpileEvent requires a sourceText string");
        }
        if (typeof symbolId !== "string" || symbolId.length === 0) {
            throw new TypeError("transpileEvent requires a symbolId string");
        }
        if (sourcePath !== undefined && (typeof sourcePath !== "string" || sourcePath.length === 0)) {
            throw new TypeError("transpileEvent requires sourcePath to be a non-empty string when provided");
        }
        if (request.thisName !== undefined && (typeof request.thisName !== "string" || request.thisName.length === 0)) {
            throw new TypeError("transpileEvent requires thisName to be a non-empty string when provided");
        }

        try {
            const ast = this.resolveProgramAst(request);

            // Pre-collect var-declared locals before building the oracle so the
            // EventContextOracle can distinguish them from instance fields.
            const localVars = collectLocalVariables(ast);
            const eventOracle = new EventContextOracle(this.getSemanticAnalyzers(), localVars);
            const emitter = new GmlToJsEmitter(eventOracle, this.emitterOptions);
            const jsBody = emitter.emit(ast);

            const timestamp = Date.now();
            const patch: EventPatch = {
                kind: "event",
                id: symbolId,
                js_body: jsBody,
                sourceText,
                version: timestamp,
                this_name: request.thisName ?? "self",
                metadata: this.buildPatchMetadata(sourcePath, emitter, timestamp)
            };
            return patch;
        } catch (error) {
            throw this.createTranspileError(`event ${symbolId}`, error);
        }
    }

    /**
     * Transpile a GML function (named or anonymous) into a `ClosurePatch`.
     *
     * A closure patch targets the runtime wrapper's closure registry and is
     * created via `new Function("...args", js_body)`. The emitted `js_body`
     * uses the same parameter-unpacking convention as `transpileScript`:
     * named parameters become `var <name> = args[<index>]` declarations at the
     * top of the body so callers can pass positional arguments normally.
     *
     * When the source contains a single function declaration, the function is
     * unwrapped and only the body (plus parameter unpacking) is emitted—the
     * `function` keyword itself is not included. When the source is a bare
     * statement block or expression, it is emitted directly.
     *
     * @example
     * ```typescript
     * const patch = transpiler.transpileClosure({
     *   sourceText: "function helper(x, y) { return x + y; }",
     *   symbolId: "gml/closure/scr_utils/helper"
     * });
     * // patch.js_body ≈ "var x = args[0];\nvar y = args[1];\nreturn (x + y);"
     * ```
     */
    transpileClosure(request: TranspileClosureRequest): ClosurePatch {
        if (!request || typeof request !== "object") {
            throw new TypeError("transpileClosure requires a request object");
        }
        const { sourceText, symbolId } = request;
        const sourcePath = request.sourcePath;
        if (typeof sourceText !== "string" || sourceText.length === 0) {
            throw new TypeError("transpileClosure requires a sourceText string");
        }
        if (typeof symbolId !== "string" || symbolId.length === 0) {
            throw new TypeError("transpileClosure requires a symbolId string");
        }
        if (sourcePath !== undefined && (typeof sourcePath !== "string" || sourcePath.length === 0)) {
            throw new TypeError("transpileClosure requires sourcePath to be a non-empty string when provided");
        }

        try {
            const ast = this.resolveProgramAst(request);
            const emitter = new GmlToJsEmitter(this.getSemanticAnalyzers(), this.emitterOptions);
            let jsBody = "";

            // Unwrap a single function declaration, emitting only the body with
            // parameter unpacking. This matches the convention expected by the
            // runtime-wrapper's `new Function("...args", patchBody)` pattern:
            // named parameters are extracted from `args[0]`, `args[1]`, etc.
            const singleFunc = this.extractSingleFunctionDeclaration(ast);
            if (singleFunc === null) {
                jsBody = emitter.emit(ast);
            } else {
                const paramUnpacking = this.emitFunctionParameterUnpacking(singleFunc, emitter);
                const bodyContent = this.emitUnwrappedFunctionBody(singleFunc.body, emitter);
                jsBody = paramUnpacking ? `${paramUnpacking}\n${bodyContent}` : bodyContent;
            }

            const timestamp = Date.now();
            const patch: ClosurePatch = {
                kind: "closure",
                id: symbolId,
                js_body: jsBody,
                sourceText,
                version: timestamp,
                metadata: this.buildPatchMetadata(sourcePath, emitter, timestamp)
            };
            return patch;
        } catch (error) {
            throw this.createTranspileError(`closure ${symbolId}`, error);
        }
    }
}
