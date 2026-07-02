import { Core } from "@gmloop/core";
import type { Linter } from "eslint";
import { Diagnostic, DiagnosticSeverity, type Range } from "vscode-languageserver/node.js";

import { type GmlTextDocument, offsetToPosition } from "../documents/index.js";

type ParserErrorLike = Readonly<{
    column?: number;
    line?: number;
    name?: string;
}>;

function createSingleCharacterRange(line: number, column: number): Range {
    const start = {
        line: Math.max(0, line - 1),
        character: Math.max(0, column)
    };
    return {
        start,
        end: {
            line: start.line,
            character: start.character + 1
        }
    };
}

/**
 * Convert a parser exception into an LSP diagnostic.
 */
export function parserErrorToDiagnostic(document: GmlTextDocument, error: unknown): Diagnostic {
    void document;
    const candidate = Core.isObjectLike(error) ? (error as ParserErrorLike) : {};
    const line = typeof candidate.line === "number" ? candidate.line : 1;
    const column = typeof candidate.column === "number" ? candidate.column : 0;

    return Diagnostic.create(
        createSingleCharacterRange(line, column),
        Core.getErrorMessageOrFallback(error),
        DiagnosticSeverity.Error,
        candidate.name ?? "parser",
        "gmloop-parser"
    );
}

/**
 * Convert an ESLint diagnostic message into an LSP diagnostic.
 */
export function eslintMessageToDiagnostic(message: Linter.LintMessage): Diagnostic {
    const startLine = Math.max(0, message.line - 1);
    const startCharacter = Math.max(0, message.column - 1);
    const endLine = Math.max(startLine, (message.endLine ?? message.line) - 1);
    const endCharacter = Math.max(startCharacter + 1, (message.endColumn ?? message.column + 1) - 1);

    return Diagnostic.create(
        {
            start: { line: startLine, character: startCharacter },
            end: { line: endLine, character: endCharacter }
        },
        message.message,
        message.severity === 2 ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        message.ruleId ?? "lint",
        "gmloop-lint"
    );
}

/**
 * Build a zero-length diagnostic range at a source offset.
 */
export function offsetDiagnosticRange(document: GmlTextDocument, offset: number): Range {
    const position = offsetToPosition(document, offset);
    return {
        start: position,
        end: position
    };
}
