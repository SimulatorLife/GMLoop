import { Core } from "@gmloop/core";

interface GameMakerSyntaxErrorOptions {
    message: string;
    line?: number | null;
    column?: number | null;
    wrongSymbol?: string | null;
    offendingText?: string | null;
    rule?: string | null;
}

export class GameMakerSyntaxError extends Error {
    public line?: number;
    public column?: number;
    public wrongSymbol?: string;
    public offendingText?: string;
    public rule?: string;

    constructor({ message, line, column, wrongSymbol, rule, offendingText }: GameMakerSyntaxErrorOptions) {
        super(message);
        this.name = "GameMakerSyntaxError";
        if (Number.isFinite(line ?? Number.NaN)) {
            this.line = Number(line);
        }
        if (Number.isFinite(column ?? Number.NaN)) {
            this.column = Number(column);
        }
        if (typeof wrongSymbol === "string") {
            this.wrongSymbol = wrongSymbol;
        }
        if (typeof offendingText === "string") {
            this.offendingText = offendingText;
        }
        if (typeof rule === "string") {
            this.rule = rule;
        }
    }

    static isParseError(error: unknown): error is GameMakerSyntaxError {
        return Core.isErrorLike(error) && error.name === "GameMakerSyntaxError";
    }
}

class SyntaxErrorFormatter {
    resolveOffendingSymbolText(offendingSymbol) {
        if (!offendingSymbol) {
            return null;
        }

        if (Core.isNonEmptyString(offendingSymbol?.text)) {
            return offendingSymbol.text;
        }

        if (Core.isNonEmptyString(offendingSymbol)) {
            return offendingSymbol;
        }

        if (typeof offendingSymbol === "number") {
            const codePoint = offendingSymbol;
            if (Number.isFinite(codePoint)) {
                return String.fromCodePoint(codePoint);
            }
        }

        return null;
    }

    extractOffendingTextFromLexerMessage(message) {
        if (!Core.isNonEmptyString(message)) {
            return null;
        }

        const match = message.match(/token recognition error at:\s*(.+)$/i);
        if (!match) {
            return null;
        }

        const rawText = match[1].trim();

        if (rawText.length === 0) {
            return null;
        }

        if (rawText.startsWith("'") && rawText.endsWith("'") && rawText.length >= 2) {
            return this.unescapeLexerToken(rawText.slice(1, -1));
        }

        return rawText;
    }

    unescapeLexerToken(text) {
        if (!Core.isNonEmptyString(text)) {
            return text;
        }

        return text.replaceAll(/\\([\\'])/g, "$1");
    }

    formatWrongSymbol(offendingText) {
        if (offendingText === "<EOF>") {
            return "end of file";
        }

        if (Core.isNonEmptyString(offendingText)) {
            return `symbol '${offendingText}'`;
        }

        return "unknown symbol";
    }

    formatRuleName(ruleName) {
        if (!Core.isNonEmptyString(ruleName)) {
            return "unknown rule";
        }

        return ruleName.replaceAll(/([A-Z]*)([A-Z][a-z])/g, "$1 $2").toLowerCase();
    }
}

interface GameMakerParseErrorListenerOptions {
    formatter?: SyntaxErrorFormatter;
    contextAnalyzer?: ParserContextAnalyzer;
}

interface GameMakerLexerErrorListenerOptions {
    formatter?: SyntaxErrorFormatter;
}

// ANTLR's `ErrorListener` interface (see docs/antlr-regeneration.md#error-handling)
// requires parsers to expose `reportAmbiguity`, `reportAttemptingFullContext`, and
// `reportContextSensitivity` callbacks. GML's parsing strategy intentionally
// ignores these notifications because the formatter, pre-typed browsers, and the
// refactor workspace care only about hard syntax errors raised through
// `syntaxError`; ambiguity and context-sensitivity traces are accepted as a
// practical cost of reusing a single grammar pass. Removing or replacing these
// stubs with throwing bodies would break `parser.removeErrorListener(...)` and
// the listener wiring in `gml-parser.ts`, silently turning recoverable
// notifications into fatal errors and corrupting downstream prettifying/codemod
// batches that intentionally suppress them.
function reportAmbiguity() {}

function reportAttemptingFullContext() {}

function reportContextSensitivity() {}

function resolveRuleInvocationStack(recognizer: unknown): Array<string> {
    if (!recognizer || typeof recognizer !== "object") {
        return [];
    }

    if (!("getRuleInvocationStack" in recognizer)) {
        return [];
    }

    const candidate = (recognizer as { getRuleInvocationStack?: unknown }).getRuleInvocationStack;
    if (typeof candidate !== "function") {
        return [];
    }

    try {
        const stack = candidate.call(recognizer);
        return Array.isArray(stack) ? stack : [];
    } catch {
        return [];
    }
}

class ParserContextAnalyzer {
    resolveOpenBlockStartToken(parser) {
        const currentContext = parser?._ctx;
        if (!currentContext) {
            return null;
        }

        const parentContext = currentContext.parentCtx;
        if (!parentContext || typeof parentContext.openBlock !== "function") {
            return null;
        }

        const openBlockContext = parentContext.openBlock();
        return openBlockContext?.start ?? null;
    }

    getSpecificErrorMessage({ parser, stack, currentRule, line, column, wrongSymbol }) {
        switch (currentRule) {
            case "closeBlock": {
                if (stack[1] !== "block") {
                    return null;
                }
                const openBraceToken = this.resolveOpenBlockStartToken(parser);
                if (!openBraceToken) {
                    return null;
                }
                return (
                    `Syntax Error (line ${openBraceToken.line}, column ${openBraceToken.column}): ` +
                    "missing associated closing brace for this block"
                );
            }
            case "lValueExpression": {
                if (stack[1] !== "incDecStatement") {
                    return null;
                }
                return (
                    `Syntax Error (line ${line}, column ${column}): ` +
                    "++, -- can only be used on a variable-addressing expression"
                );
            }
            case "expression": {
                return `Syntax Error (line ${line}, column ${column}): ` + `unexpected ${wrongSymbol} in expression`;
            }
            case "statement":
            case "program": {
                return `Syntax Error (line ${line}, column ${column}): ` + `unexpected ${wrongSymbol}`;
            }
            case "parameterList": {
                return (
                    `Syntax Error (line ${line}, column ${column}): ` +
                    `unexpected ${wrongSymbol} in function parameters, expected an identifier`
                );
            }
            default: {
                return null;
            }
        }
    }
}

function createGameMakerParseErrorListener({
    formatter = new SyntaxErrorFormatter(),
    contextAnalyzer = new ParserContextAnalyzer()
}: GameMakerParseErrorListenerOptions = {}) {
    // Broaden the diagnostic surface so syntax errors surface the same
    // hints that GameMaker Studio does. Today we lean on ANTLR's generic
    // messages, which are technically correct but omit recovery advice such as
    // "missing semicolon" or "unclosed struct literal". Formatter users jump to
    // this code when the parser rejects a file, so investing in richer messages
    // (potentially by mirroring the official compiler's phrasing documented in
    // https://manual.gamemaker.io/monthly/en/#t=GameMaker_Language%2FGML_Overview%2FGML_Syntax.htm) would keep support queues
    // manageable and prevent editor integrations from falling back to
    // unhelpful "syntax error" toasts.
    function syntaxError(recognizer, offendingSymbol, line, column, _message, _error) {
        const parser = recognizer;
        void _message;
        void _error;
        const offendingText = formatter.resolveOffendingSymbolText(offendingSymbol);
        const wrongSymbol = formatter.formatWrongSymbol(offendingText);

        const stack = resolveRuleInvocationStack(parser);
        const currentRule = stack[0];

        const createError = (message) =>
            new GameMakerSyntaxError({
                message,
                line,
                column,
                wrongSymbol,
                rule: currentRule,
                offendingText
            });

        const specificMessage = contextAnalyzer.getSpecificErrorMessage({
            parser,
            stack,
            currentRule,
            line,
            column,
            wrongSymbol
        });

        if (specificMessage) {
            throw createError(specificMessage);
        }

        const currentRuleFormatted = formatter.formatRuleName(currentRule);

        throw createError(
            `Syntax Error (line ${line}, column ${column}): ` +
                `unexpected ${wrongSymbol}` +
                ` while matching rule ${currentRuleFormatted}`
        );
    }

    return {
        syntaxError,
        reportAmbiguity,
        reportAttemptingFullContext,
        reportContextSensitivity,
        formatter,
        contextAnalyzer
    };
}

export default createGameMakerParseErrorListener;

export function createGameMakerLexerErrorListener({
    formatter = new SyntaxErrorFormatter()
}: GameMakerLexerErrorListenerOptions = {}) {
    function syntaxError(lexer, offendingSymbol, line, column, message, _error) {
        void _error;
        const offendingText =
            formatter.resolveOffendingSymbolText(offendingSymbol) ??
            formatter.extractOffendingTextFromLexerMessage(message);
        const wrongSymbol = formatter.formatWrongSymbol(offendingText);

        throw new GameMakerSyntaxError({
            message: `Syntax Error (line ${line}, column ${column}): ` + `unexpected ${wrongSymbol}`,
            line,
            column,
            wrongSymbol,
            offendingText
        });
    }

    return {
        syntaxError,
        formatter
    };
}
