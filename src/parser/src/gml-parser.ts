import { Core } from "@gmloop/core";
import antlr4 from "antlr4";

import GameMakerLanguageLexer from "../generated/GameMakerLanguageLexer.js";
import GameMakerLanguageParser from "../generated/GameMakerLanguageParser.js";
import { convertToESTree } from "./ast/estree-converter.js";
import GameMakerASTBuilder from "./ast/gml-ast-builder.js";
import createGameMakerParseErrorListener, { createGameMakerLexerErrorListener } from "./ast/gml-syntax-error.js";
import { createHiddenNodeProcessor } from "./ast/hidden-node-processor.js";
import { assertNestedTernaryConsequentsAreParenthesized } from "./ast/ternary-expression-grouping-validation.js";
import { installRecognitionExceptionLikeGuard } from "./runtime/index.js";
import { defaultParserOptions, type ParserOptions } from "./types/index.js";

const PredictionMode =
    (antlr4 as unknown as { atn?: { PredictionMode: unknown } }).atn?.PredictionMode ??
    (antlr4 as any).PredictionMode ??
    (antlr4 as any).atn?.PredictionMode;

installRecognitionExceptionLikeGuard();

/**
 * Merges parser option overrides with base defaults.
 *
 * @param baseOptions - The default parser options to use as a foundation.
 * @param overrides - Optional partial overrides to apply on top of defaults. Non-object values are ignored.
 * @returns A complete ParserOptions object with overrides applied.
 *
 * @remarks
 * This function ensures that even when `overrides` is null, undefined, or a non-object,
 * a valid options object is always returned by treating such values as empty overrides.
 */
function mergeParserOptions(baseOptions: ParserOptions, overrides: Partial<ParserOptions> | undefined): ParserOptions {
    const overrideObject = Core.isObjectLike(overrides) ? overrides : {};
    return Object.assign({}, baseOptions, overrideObject) as ParserOptions;
}

function getNodeIndex(node: Record<string, unknown>, prop: "start" | "end"): number | undefined {
    const value = node[prop];
    if (typeof value === "number") {
        return value;
    }
    if (value && typeof (value as { index?: unknown }).index === "number") {
        return (value as { index: number }).index;
    }
    return undefined;
}

function getPredictionMode(modeName: "SLL" | "LL"): unknown {
    const mode = (PredictionMode as Record<string, unknown> | undefined)?.[modeName];
    if (mode === undefined) {
        throw new Error(`ANTLR prediction mode '${modeName}' is unavailable.`);
    }

    return mode;
}

function throwNormalizedParserError(error: unknown): never {
    if (!error) {
        throw new Error("Unknown syntax error while parsing GML source.");
    }

    if (Core.isErrorLike(error)) {
        throw error;
    }

    throw new Error(Core.getErrorMessageOrFallback(error));
}

function parseProgramWithLlPredictionMode(sourceText: string): unknown {
    try {
        const llChars = new antlr4.InputStream(sourceText);
        const llLexer = new GameMakerLanguageLexer(llChars);
        llLexer.removeErrorListeners();
        llLexer.addErrorListener(createGameMakerLexerErrorListener());
        llLexer.strictMode = false;

        const llTokens = new antlr4.CommonTokenStream(llLexer);
        const llParser = new GameMakerLanguageParser(llTokens);
        llParser.removeErrorListeners();
        llParser.addErrorListener(createGameMakerParseErrorListener());
        llParser._interp.predictionMode = getPredictionMode("LL");
        return llParser.program();
    } catch (error) {
        throwNormalizedParserError(error);
    }
}

const MAX_SOURCE_LENGTH_FOR_SLL_PARSING = 8000;

function shouldUseSllPredictionMode(sourceText: string): boolean {
    return sourceText.length <= MAX_SOURCE_LENGTH_FOR_SLL_PARSING;
}

/**
 * Parser for GameMaker Language (GML) source code.
 *
 * Transforms raw GML source text into an Abstract Syntax Tree (AST) suitable for
 * formatting, analysis, or transformation. The parser leverages ANTLR-generated
 * lexer and parser components and provides fine-grained control over output format,
 * comment extraction, and location metadata.
 *
 * @example
 * ```typescript
 * // Parse with default options
 * const ast = GMLParser.parse("x = 42;");
 *
 * // Parse with custom options
 * const parser = new GMLParser("function foo() { return true; }", {
 *   getComments: false,
 *   simplifyLocations: false
 * });
 * const ast = parser.parse();
 * ```
 *
 * @remarks
 * The parser normalizes escape sequences in string literals during preprocessing
 * to handle edge cases in ANTLR's lexer. The original literal text is restored
 * post-parse if normalization occurred. Consumers should not rely on the internal
 * `text` property differing from `originalText` except during active parsing.
 */
export class GMLParser {
    /**
     * The unmodified source text as provided to the constructor.
     *
     * @remarks
     * This property preserves the exact input, including any escape sequences or
     * formatting quirks, so that literal values can be restored after normalization.
     */
    public originalText: string;

    /**
     * The preprocessed source text used for parsing.
     *
     * @remarks
     * Escape sequences in string literals are normalized to avoid lexer ambiguities.
     * After parsing completes, the original literal text is restored from `originalText`.
     */
    public text: string;

    /**
     * Whitespace tokens collected during lexical analysis.
     *
     * @remarks
     * Populated only when options.getComments is true. Each entry represents a
     * contiguous span of whitespace extracted by the hidden-node processor.
     */
    public whitespaces: Array<unknown>;

    /**
     * Comment tokens collected during lexical analysis.
     *
     * @remarks
     * Populated only when options.getComments is true. Comments include both
     * single-line (//) and multi-line (block comment) forms, along with any adjacent
     * whitespace needed to preserve formatting context.
     */
    public comments: Array<unknown>;

    /**
     * Merged parser configuration.
     *
     * @remarks
     * Combines the static optionDefaults from the parser class with any overrides
     * provided at construction time. Subclasses can override optionDefaults to
     * change the baseline behavior.
     */
    public options: ParserOptions;

    /**
     * Constructs a new GML parser instance.
     *
     * @param text - The raw GML source code to parse.
     * @param options - Optional configuration overrides. Defaults are merged from
     *   the static optionDefaults property.
     *
     * @throws {SourceTextValidationError} When text is null, undefined, not a string,
     *   or exceeds the maximum allowed length (10MB by default).
     *
     * @remarks
     * The constructor validates the input text before processing to prevent crashes
     * from malformed or malicious input. It then normalizes escape sequences in text
     * for lexer compatibility. The original text is preserved in originalText and
     * restored post-parse if needed.
     */
    constructor(text: string, options: Partial<ParserOptions> = {}) {
        const validatedText = Core.validateSourceText(text);
        this.originalText = validatedText;
        this.text = Core.normalizeSimpleEscapeCase(validatedText);
        this.whitespaces = [];
        this.comments = [];
        const parserConstructor = (this.constructor as typeof GMLParser | undefined) ?? GMLParser;
        this.options = mergeParserOptions(parserConstructor.optionDefaults, options);
    }

    /**
     * Default parser options used when no overrides are provided.
     *
     * @remarks
     * Subclasses can replace this property to change the baseline configuration.
     * Instance constructors merge these defaults with any provided overrides.
     */
    static optionDefaults: ParserOptions = defaultParserOptions;

    /**
     * Parses GML source code into an AST using a new parser instance.
     *
     * @param text - The GML source code to parse.
     * @param options - Optional configuration overrides.
     * @returns The parsed AST. Structure depends on the astFormat option:
     *   - "gml" (default): GML-specific AST nodes.
     *   - "estree": ESTree-compatible representation.
     *   If asJSON is true, returns a JSON string instead of an object.
     *
     * @throws {Error} When the source contains syntax errors or the parser encounters
     *   an unrecoverable state.
     *
     * @example
     * ```typescript
     * const ast = GMLParser.parse("x = 10;");
     * ```
     */
    static parse(text: string, options?: Partial<ParserOptions>) {
        return new this(text, options).parse();
    }

    /**
     * Parses the GML source code into an AST.
     *
     * @returns The parsed AST. The structure and format depend on the parser options:
     *   - When options.astFormat is "gml" (default), returns GML-specific AST nodes.
     *   - When options.astFormat is "estree", returns an ESTree-compatible representation.
     *   - When options.asJSON is true, returns a JSON string instead of an object.
     *   - When options.getComments is false, the comments property is omitted.
     *   - When options.getLocations is false, location metadata is stripped from all nodes.
     *
     * @throws {Error} When the source contains syntax errors or the parser encounters
     *   an unrecoverable state during lexing or parsing.
     *
     * @remarks
     * The parse process follows these steps:
     * 1. Tokenize the preprocessed source using the ANTLR lexer.
     * 2. Parse tokens using SLL prediction mode for speed, then retry in LL mode when needed.
     * 3. If getComments is enabled, re-lex to extract hidden tokens (comments, whitespace).
     * 4. Build the AST from the parse tree.
     * 5. Attach comments to the AST if requested.
     * 6. Remove or simplify location metadata based on options.
     * 7. Restore original literal text if normalization occurred.
     * 8. Convert to ESTree format if requested.
     * 9. Serialize to JSON if asJSON is enabled.
     *
     * Edge cases:
     * - If the source is empty, returns a program node with an empty body.
     * - Syntax errors trigger an exception with details from the error listener.
     * - The parser starts in SLL mode for performance and retries in LL mode when
     *   the first pass cannot decide between valid alternatives.
     */
    parse() {
        const chars = new antlr4.InputStream(this.text);
        const lexer = new GameMakerLanguageLexer(chars);
        lexer.removeErrorListeners();
        lexer.addErrorListener(createGameMakerLexerErrorListener());
        lexer.strictMode = false;
        const tokens = new antlr4.CommonTokenStream(lexer);
        const parser = new GameMakerLanguageParser(tokens);

        parser.removeErrorListeners();
        parser.addErrorListener(createGameMakerParseErrorListener());

        let tree;
        if (shouldUseSllPredictionMode(this.text)) {
            try {
                parser._interp.predictionMode = getPredictionMode("SLL");
                tree = parser.program();
            } catch (error) {
                try {
                    tree = parseProgramWithLlPredictionMode(this.text);
                } catch {
                    throwNormalizedParserError(error);
                }
            }
        } else {
            tree = parseProgramWithLlPredictionMode(this.text);
        }

        if (this.options.getComments) {
            // Reset the lexer to the beginning of the input stream. This is critical
            // because the lexer maintains internal position state from the previous parse
            // attempt. If we don't reset it, the lexer would start tokenizing from wherever
            // it stopped during the main parse (e.g., midway through the file), causing
            // the comment extraction pass to miss leading comments or produce corrupted
            // token positions. Resetting ensures the comment pass starts fresh, treating
            // the input as a complete document. Without this reset, comment attachment
            // would be unreliable, and users would see missing or misplaced comments in
            // the formatted output.
            lexer.reset();
            (chars as any).seek(0);
            lexer.ignoreNewline = false;
            (lexer as any).templateDepth = 0;

            this.getHiddenNodes(lexer);
        }

        const builder = new GameMakerASTBuilder(this.options, this.whitespaces);
        let astTree;
        astTree = builder.build(tree);
        assertNestedTernaryConsequentsAreParenthesized(this.text, astTree);

        if (this.options.getComments) {
            astTree.comments = this.comments;

            if (this.options.attachFunctionDocComments) {
                Core.normalizeFunctionDocCommentAttachments(astTree, this.comments, this.text);
            }
        }

        const shouldConvertToESTree =
            typeof this.options.astFormat === "string" && this.options.astFormat.toLowerCase() === "estree";

        if (!this.options.getLocations) {
            this.removeLocationInfo(astTree);
        } else if (!shouldConvertToESTree && this.options.simplifyLocations) {
            this.simplifyLocationInfo(astTree);
        }

        if (this.originalText !== this.text) {
            this.restoreOriginalLiteralText(astTree);
        }

        if (shouldConvertToESTree) {
            astTree = convertToESTree(astTree, {
                includeLocations: this.options.getLocations,
                includeRange: this.options.getLocations && this.options.simplifyLocations,
                includeComments: this.options.getComments
            });
        }

        if (this.options.asJSON) {
            return JSON.stringify(astTree);
        }

        return astTree;
    }

    /**
     * Restores the original escape sequences and literal text in the AST.
     *
     * @param root - The AST root node to process.
     *
     * @remarks
     * The parser normalizes escape sequences in string literals during preprocessing
     * to avoid lexer ambiguities. After the AST is built, this method walks the tree
     * and replaces the normalized text with the original literal text from originalText.
     *
     * Only applies to:
     * - Literal nodes with quoted string values.
     * - TemplateStringText nodes.
     *
     * The method uses start/end indices from the AST to extract the correct substring
     * from originalText. If indices are invalid or missing, the node is left unchanged.
     */
    restoreOriginalLiteralText(root) {
        if (!root || typeof root !== "object") {
            return;
        }

        Core.walkObjectGraph(root, {
            enterObject: (node) => {
                const startIndex = getNodeIndex(node, "start");
                const endIndex = getNodeIndex(node, "end");

                if (node.type === "Literal" && Core.isQuotedString(node.value)) {
                    if (Number.isInteger(startIndex) && Number.isInteger(endIndex) && endIndex >= startIndex) {
                        node.value = this.originalText.slice(startIndex, endIndex + 1);
                    }
                    return;
                }

                if (
                    node.type === "TemplateStringText" &&
                    Number.isInteger(startIndex) &&
                    Number.isInteger(endIndex) &&
                    endIndex >= startIndex
                ) {
                    node.value = this.originalText.slice(startIndex, endIndex + 1);
                }
            }
        });
    }

    /**
     * Extracts comments and whitespace tokens from the source.
     *
     * @param lexer - The ANTLR lexer instance to tokenize the source.
     *
     * @remarks
     * This method re-lexes the entire source to capture hidden tokens (comments and
     * whitespace) that are normally ignored during parsing. The extracted tokens are
     * stored in the comments and whitespaces arrays.
     *
     * Called only when options.getComments is true. The lexer is reset to the
     * beginning of the input stream before processing to ensure all tokens are captured.
     *
     * Token types processed:
     * - SingleLineComment: // ...
     * - MultiLineComment: block comment syntax
     * - WhiteSpaces: Runs of spaces, tabs, etc.
     * - LineTerminator: Newlines and carriage returns.
     * - EOF: End-of-file marker.
     *
     * The hidden-node processor annotates comments with surrounding whitespace
     * and other contextual metadata needed for accurate formatting.
     */
    getHiddenNodes(lexer) {
        const { EOF, SingleLineComment, MultiLineComment, WhiteSpaces, LineTerminator } = GameMakerLanguageLexer;
        const processor = createHiddenNodeProcessor({
            comments: this.comments,
            whitespaces: this.whitespaces,
            lexerTokens: {
                EOF,
                SingleLineComment,
                MultiLineComment,
                WhiteSpaces,
                LineTerminator
            }
        });

        while (!processor.hasReachedEnd()) {
            processor.processToken(lexer.nextToken());
        }
    }

    /**
     * Removes all location metadata from the AST.
     *
     * @param obj - The AST node or tree to process.
     *
     * @remarks
     * Delegates to Core.removeLocationMetadata to strip start/end/loc properties
     * from all nodes in the tree. Used when options.getLocations is false to reduce
     * memory footprint and simplify output for consumers that don't need position data.
     */
    removeLocationInfo(obj) {
        Core.removeLocationMetadata(obj);
    }

    /**
     * Simplifies location metadata to a more compact representation.
     *
     * @param obj - The AST node or tree to process.
     *
     * @remarks
     * Delegates to Core.simplifyLocationMetadata to convert verbose location objects
     * to simpler forms (e.g., line/column tuples or offsets). Used when
     * options.simplifyLocations is true to balance precision with memory efficiency.
     */
    simplifyLocationInfo(obj) {
        Core.simplifyLocationMetadata(obj);
    }
}

/**
 * Re-exported utility function for counting line breaks in a string.
 *
 * @remarks
 * This convenience export allows consumers to access Core.getLineBreakCount
 * directly from the parser module without importing @gmloop/core.
 * Useful for calculating line metrics or validating source spans.
 */
export const getLineBreakCount: typeof Core.getLineBreakCount = Core.getLineBreakCount;
