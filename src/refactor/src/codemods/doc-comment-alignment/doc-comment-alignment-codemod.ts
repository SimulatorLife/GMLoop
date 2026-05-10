import { applySourceTextEdits, type CodemodSourceTextEdit } from "../codemod-helpers.js";
import type {
    DocCommentAlignmentCodemodOptions,
    DocCommentAlignmentCodemodResult,
    DocCommentAlignmentEdit
} from "./types.js";

type ParsedFunctionSignature = Readonly<{
    name: string | null;
    parameterNames: ReadonlyArray<string>;
    parameterDefaultsByName: ReadonlyMap<string, string>;
}>;

type DocParamLine = Readonly<{
    lineIndex: number;
    indentation: string;
    rawName: string;
    suffix: string;
    isOptional: boolean;
}>;

function normalizeIdentifierForMatch(name: string): string {
    const trimmed = name.replace(/^_+/u, "");
    const withUnderscores = trimmed.replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2");
    return withUnderscores
        .replaceAll(/[^A-Za-z0-9_]+/gu, "_")
        .replaceAll(/_+/gu, "_")
        .toLowerCase();
}

function findFunctionSignature(sourceText: string, startOffset: number): ParsedFunctionSignature | null {
    const prefix = sourceText.slice(startOffset);
    const match = /^([ \t]*)function[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*\(/u.exec(prefix);
    if (!match) {
        return null;
    }

    const name = match[2] ?? null;
    const openParenOffset = startOffset + (match[0].length - 1);

    let cursor = openParenOffset + 1;
    let depth = 1;
    let inString: '"' | "'" | null = null;
    let escaped = false;
    while (cursor < sourceText.length) {
        const char = sourceText[cursor];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === inString) {
                inString = null;
            }
            cursor += 1;
            continue;
        }

        if (char === '"' || char === "'") {
            inString = char;
            cursor += 1;
            continue;
        }

        if (char === "(") {
            depth += 1;
        } else if (char === ")") {
            depth -= 1;
            if (depth === 0) {
                break;
            }
        }

        cursor += 1;
    }

    if (depth !== 0) {
        return null;
    }

    const paramsText = sourceText.slice(openParenOffset + 1, cursor);
    const parameterNames: Array<string> = [];
    const defaultsByName = new Map<string, string>();

    const parts: Array<string> = [];
    let partStart = 0;
    cursor = 0;
    depth = 0;
    inString = null;
    escaped = false;
    while (cursor <= paramsText.length) {
        const char = paramsText[cursor] ?? ",";
        if (cursor < paramsText.length) {
            if (inString) {
                if (escaped) {
                    escaped = false;
                } else if (char === "\\") {
                    escaped = true;
                } else if (char === inString) {
                    inString = null;
                }
                cursor += 1;
                continue;
            }

            if (char === '"' || char === "'") {
                inString = char;
                cursor += 1;
                continue;
            }

            if (char === "(" || char === "[" || char === "{") {
                depth += 1;
            } else if (char === ")" || char === "]" || char === "}") {
                depth = Math.max(0, depth - 1);
            }
        }

        if (depth === 0 && (char === "," || cursor === paramsText.length)) {
            const entry = paramsText.slice(partStart, cursor).trim();
            parts.push(entry);
            partStart = cursor + 1;
        }

        cursor += 1;
    }

    for (const rawPart of parts) {
        if (!rawPart) {
            continue;
        }
        const equalsIndex = rawPart.indexOf("=");
        const namePart = (equalsIndex === -1 ? rawPart : rawPart.slice(0, equalsIndex)).trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(namePart)) {
            continue;
        }
        parameterNames.push(namePart);
        if (equalsIndex !== -1) {
            const defaultText = rawPart.slice(equalsIndex + 1).trim();
            if (defaultText.length > 0) {
                defaultsByName.set(namePart, defaultText);
            }
        }
    }

    return Object.freeze({
        name,
        parameterNames,
        parameterDefaultsByName: defaultsByName
    });
}

function parseDocParamLine(line: string, lineIndex: number): DocParamLine | null {
    const match = /^([ \t]*)\/\/\/[ \t]*@param[ \t]+(\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)(.*)$/u.exec(line);
    if (!match) {
        return null;
    }

    const indentation = match[1] ?? "";
    const rawToken = match[2] ?? "";
    const suffix = (match[3] ?? "").trimEnd();
    const isOptional = rawToken.startsWith("[") && rawToken.endsWith("]");
    const rawName = isOptional ? (rawToken.slice(1, -1).split("=", 1)[0]?.trim() ?? "") : rawToken.trim();

    if (!rawName) {
        return null;
    }

    return Object.freeze({
        lineIndex,
        indentation,
        rawName,
        suffix,
        isOptional
    });
}

function alignDocParamsForBlock(
    lines: ReadonlyArray<string>,
    blockStartIndex: number,
    blockEndIndex: number,
    signature: ParsedFunctionSignature
): { updatedLines: ReadonlyArray<string>; changed: boolean } {
    const docParamLines: Array<DocParamLine> = [];
    for (let index = blockStartIndex; index <= blockEndIndex; index += 1) {
        const parsed = parseDocParamLine(lines[index] ?? "", index);
        if (parsed) {
            docParamLines.push(parsed);
        }
    }

    if (docParamLines.length === 0 || signature.parameterNames.length === 0) {
        return { updatedLines: lines, changed: false };
    }

    const paramByCanonical = new Map<string, string>();
    for (const paramName of signature.parameterNames) {
        paramByCanonical.set(normalizeIdentifierForMatch(paramName), paramName);
    }

    const docLineByCanonical = new Map<string, DocParamLine>();
    for (const docLine of docParamLines) {
        const canonical = normalizeIdentifierForMatch(docLine.rawName);
        if (!docLineByCanonical.has(canonical)) {
            docLineByCanonical.set(canonical, docLine);
        }
    }

    const indentation = docParamLines[0]?.indentation ?? "";
    const rebuiltParamLines: Array<string> = [];

    for (const parameterName of signature.parameterNames) {
        const canonical = normalizeIdentifierForMatch(parameterName);
        const existing = docLineByCanonical.get(canonical) ?? null;
        const defaultValue = signature.parameterDefaultsByName.get(parameterName) ?? null;

        const suffix = existing?.suffix ? ` ${existing.suffix.trimStart()}` : "";
        const hasDefault = defaultValue !== null;
        const needsOptionalToken = hasDefault;

        const tokenName = parameterName;
        const optionalToken = needsOptionalToken
            ? `[${tokenName}${defaultValue ? `=${defaultValue}` : ""}]`
            : tokenName;

        rebuiltParamLines.push(`${indentation}/// @param ${optionalToken}${suffix}`.trimEnd());
    }

    // Preserve any doc param lines that don't match the signature (unmapped) by
    // keeping them in their original relative order after the aligned block.
    const unmatched: Array<DocParamLine> = docParamLines.filter((docLine) => {
        const canonical = normalizeIdentifierForMatch(docLine.rawName);
        return !paramByCanonical.has(canonical);
    });
    for (const docLine of unmatched) {
        rebuiltParamLines.push(lines[docLine.lineIndex] ?? "");
    }

    const firstParamIndex = docParamLines[0]?.lineIndex ?? blockStartIndex;
    const lastParamIndex = docParamLines.at(-1)?.lineIndex ?? blockEndIndex;

    const nextLines = [...lines];
    nextLines.splice(firstParamIndex, lastParamIndex - firstParamIndex + 1, ...rebuiltParamLines);

    const originalParamBlock = lines.slice(firstParamIndex, lastParamIndex + 1).join("\n");
    const rebuiltParamBlock = rebuiltParamLines.join("\n");
    return { updatedLines: nextLines, changed: originalParamBlock !== rebuiltParamBlock };
}

export function applyDocCommentAlignmentCodemod(
    sourceText: string,
    _options: DocCommentAlignmentCodemodOptions = {}
): DocCommentAlignmentCodemodResult {
    const edits: Array<DocCommentAlignmentEdit> = [];
    const lines = sourceText.split("\n");
    const lineStartOffsets: Array<number> = [];
    {
        let offset = 0;
        for (const line of lines) {
            lineStartOffsets.push(offset);
            offset += line.length + 1;
        }
    }

    // Identify doc-comment blocks immediately preceding `function ...(` declarations.
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        if (!/^[ \t]*function[ \t]+[A-Za-z_][A-Za-z0-9_]*[ \t]*\(/u.test(line)) {
            continue;
        }

        let docEnd = index - 1;
        while (docEnd >= 0 && (lines[docEnd]?.trim().length ?? 0) === 0) {
            docEnd -= 1;
        }

        if (docEnd < 0) {
            continue;
        }

        let docStart = docEnd;
        while (docStart >= 0 && (lines[docStart]?.trimStart().startsWith("///") ?? false)) {
            docStart -= 1;
        }
        docStart += 1;

        if (docStart > docEnd) {
            continue;
        }

        const functionOffset = lineStartOffsets[index] ?? 0;
        const signature = findFunctionSignature(sourceText, functionOffset);
        if (!signature) {
            continue;
        }

        const aligned = alignDocParamsForBlock(lines, docStart, docEnd, signature);
        if (!aligned.changed) {
            continue;
        }

        const newBlockText = aligned.updatedLines.slice(docStart, docEnd + 1).join("\n");
        const originalBlockText = lines.slice(docStart, docEnd + 1).join("\n");

        if (newBlockText === originalBlockText) {
            continue;
        }

        // Convert line-range to character offsets.
        let startOffset = 0;
        for (let i = 0; i < docStart; i += 1) {
            startOffset += (lines[i]?.length ?? 0) + 1;
        }
        let endOffset = startOffset;
        for (let i = docStart; i <= docEnd; i += 1) {
            endOffset += (lines[i]?.length ?? 0) + 1;
        }
        endOffset = Math.max(startOffset, endOffset - 1);

        edits.push(
            Object.freeze({
                start: startOffset,
                end: endOffset,
                text: newBlockText
            })
        );
    }

    if (edits.length === 0) {
        return {
            changed: false,
            outputText: sourceText,
            appliedEdits: []
        };
    }

    const outputText = applySourceTextEdits(sourceText, edits satisfies Array<CodemodSourceTextEdit>);
    return {
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: edits
    };
}
