/**
 * Delimited list printing utilities for the GML formatter.
 *
 * This module contains functions for printing comma-separated and otherwise
 * delimited sequences of AST elements (function arguments, parameters, array
 * elements, struct properties, enum members, etc.).
 *
 * The key functions are:
 * - printDelimitedList   – core delimited list printer with full control
 * - printCommaSeparatedList – wrapper for comma-delimited lists
 * - printElements         – iterates over list elements, handling delimiters and line breaks
 * - buildCallArgumentsDocs – builds inline/multiline variants for call arguments
 * - buildFunctionParameterDocs – builds inline/multiline variants for function params
 * - countLeadingSimpleCallArguments – counts simple arguments at the start
 * - buildCallbackArgumentsWithSimplePrefix – handles mixed simple/callback arguments
 */
import { Core } from "@gmloop/core";

import { TRAILING_COMMA } from "../options/index.js";
import { breakParent, concat, group, hardline, ifBreak, indent, line, softline } from "./prettier-doc-builders.js";
import { isCallbackArgument, isComplexArgumentNode, isSimpleCallArgument } from "./type-guards.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Inline version of docHasTrailingComment check to avoid circular imports.
 * Returns true when the last item in doc is a trailing comment token.
 */
function docHasTrailingCommentInline(doc: any): boolean {
    if (!Core.isNonEmptyArray(doc)) {
        return false;
    }

    const lastItem = doc.at(-1);
    if (!Core.isNonEmptyArray(lastItem)) {
        return false;
    }

    const commentArr = lastItem[0];
    if (!Core.isNonEmptyArray(commentArr)) {
        return false;
    }

    return commentArr.some((item: any) => {
        return typeof item === "string" && (item.startsWith("//") || item.startsWith("/*"));
    });
}

/**
 * Checks if trailing commas should be allowed based on the options.
 */
export function shouldAllowTrailingComma(options: any): boolean {
    return options?.trailingComma === TRAILING_COMMA.ALL;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function printDelimitedList(
    path: any,
    print: any,
    listKey: string,
    startChar: string,
    endChar: string,
    overrides: any = {}
) {
    const {
        delimiter = ",",
        allowTrailingDelimiter = false,
        leadingNewline = true,
        trailingNewline = true,
        forceBreak = false,
        padding = "",
        addIndent = true,
        groupId,
        forceInline = false,
        maxElementsPerLine = Infinity
    } = overrides;
    const lineBreak = forceBreak ? hardline : line;
    const finalDelimiter = allowTrailingDelimiter ? delimiter : "";

    const innerDoc = [
        ifBreak(leadingNewline ? lineBreak : "", padding),
        printElements(path, print, listKey, delimiter, lineBreak, maxElementsPerLine)
    ];

    const groupElements = [
        startChar,
        addIndent ? indent(innerDoc) : innerDoc,
        // always print a trailing delimiter if the list breaks
        ifBreak([finalDelimiter, trailingNewline ? lineBreak : ""], padding),
        endChar
    ];

    const groupElementsNoBreak = [
        startChar,
        padding,
        printElements(path, print, listKey, delimiter, " ", maxElementsPerLine),
        padding,
        endChar
    ];

    return forceInline ? groupElementsNoBreak : group(groupElements, { id: groupId });
}

export function printCommaSeparatedList(
    path: any,
    print: any,
    listKey: string,
    startChar: string,
    endChar: string,
    options: any,
    overrides: any = {}
) {
    const allowTrailingDelimiter =
        overrides.allowTrailingDelimiter === undefined
            ? shouldAllowTrailingComma(options)
            : overrides.allowTrailingDelimiter;

    return printDelimitedList(path, print, listKey, startChar, endChar, {
        delimiter: ",",
        ...overrides,
        allowTrailingDelimiter
    });
}

// print a delimited sequence of elements
// handles the case where a trailing comment follows a delimiter
export function printElements(
    path: any,
    print: any,
    listKey: string,
    delimiter: string,
    lineBreak: any,
    maxElementsPerLine = Infinity
) {
    const node = path.getValue();
    const finalIndex = node[listKey].length - 1;
    let itemsSinceLastBreak = 0;
    return path.map((childPath: any, index: number) => {
        const parts: any[] = [];
        const printed = print();
        const separator = index === finalIndex ? "" : delimiter;

        // NOTE: docHasTrailingComment must be imported/called from expression-print-utils
        // We check inline to avoid circular imports
        if (docHasTrailingCommentInline(printed)) {
            printed.splice(-1, 0, separator);
            parts.push(printed);
        } else {
            parts.push(printed, separator);
        }

        if (index !== finalIndex) {
            const hasLimit = Number.isFinite(maxElementsPerLine) && maxElementsPerLine > 0;
            itemsSinceLastBreak += 1;
            if (hasLimit) {
                const childNode = childPath.getValue();
                const nextNode = index < finalIndex ? node[listKey][index + 1] : null;
                const shouldBreakAfter =
                    isComplexArgumentNode(childNode) ||
                    isComplexArgumentNode(nextNode) ||
                    itemsSinceLastBreak >= maxElementsPerLine;

                if (shouldBreakAfter) {
                    parts.push(hardline);
                    itemsSinceLastBreak = 0;
                } else {
                    parts.push(" ");
                }
            } else {
                parts.push(lineBreak);
            }
        }

        return parts;
    }, listKey);
}

export function buildCallArgumentsDocs(
    path: any,
    print: any,
    options: any,
    {
        forceBreak = false,
        maxElementsPerLine = Infinity,
        includeInlineVariant = false,
        hasCallbackArguments = false,
        forceInline = false
    } = {}
) {
    const node = path.getValue();
    const simplePrefixLength = countLeadingSimpleCallArguments(node);
    const hasTrailingArguments = Array.isArray(node?.arguments) && node.arguments.length > simplePrefixLength;

    if (simplePrefixLength > 1 && hasTrailingArguments && hasCallbackArguments && maxElementsPerLine === Infinity) {
        const inlineDoc = includeInlineVariant
            ? printCommaSeparatedList(path, print, "arguments", "(", ")", options, {
                  addIndent: false,
                  forceInline: true,
                  leadingNewline: false,
                  trailingNewline: false,
                  maxElementsPerLine
              })
            : null;

        const multilineDoc = buildCallbackArgumentsWithSimplePrefix(path, print, simplePrefixLength);

        return { inlineDoc, multilineDoc };
    }

    const firstArgumentNode = node.arguments?.[0];
    const firstArgumentText = firstArgumentNode?.value;
    const firstArgumentIsStringLiteral =
        firstArgumentNode != null &&
        firstArgumentNode.type === Core.LITERAL &&
        typeof firstArgumentText === "string" &&
        (firstArgumentText.startsWith('"') || firstArgumentText.startsWith("'") || firstArgumentText.startsWith('@"'));

    // NOTE: intentionally omit logging to keep production output clean.

    if (
        simplePrefixLength > 1 &&
        hasTrailingArguments &&
        !hasCallbackArguments &&
        maxElementsPerLine === Infinity &&
        firstArgumentIsStringLiteral
    ) {
        const multilineDoc = buildCallbackArgumentsWithSimplePrefix(path, print, simplePrefixLength);
        return { inlineDoc: null, multilineDoc };
    }

    const multilineDoc = printCommaSeparatedList(path, print, "arguments", "(", ")", options, {
        forceBreak,
        forceInline,
        maxElementsPerLine
    });

    const inlineDoc = includeInlineVariant
        ? printCommaSeparatedList(path, print, "arguments", "(", ")", options, {
              addIndent: false,
              forceInline: true,
              leadingNewline: false,
              trailingNewline: false,
              maxElementsPerLine
          })
        : null;

    return { inlineDoc, multilineDoc };
}

export function buildFunctionParameterDocs(path: any, print: any, options: any, overrides: any = {}) {
    const forceInline = overrides.forceInline === true;

    const inlineDoc = printCommaSeparatedList(path, print, "params", "(", ")", options, {
        addIndent: false,
        allowTrailingDelimiter: false,
        forceInline: true,
        leadingNewline: false,
        trailingNewline: false
    });

    const multilineDoc = forceInline
        ? inlineDoc
        : printCommaSeparatedList(path, print, "params", "(", ")", options, {
              allowTrailingDelimiter: false
          });

    return { inlineDoc, multilineDoc };
}

export function countLeadingSimpleCallArguments(node: any): number {
    const args = node?.arguments;
    if (!Array.isArray(args) || args.length === 0) {
        return 0;
    }

    let count = 0;
    for (const argument of args) {
        if (!isSimpleCallArgument(argument)) {
            break;
        }

        count += 1;
    }

    return count;
}

export function buildCallbackArgumentsWithSimplePrefix(path: any, print: any, simplePrefixLength: number) {
    const node = path.getValue();
    const args = node?.arguments;

    if (!Array.isArray(args) || args.length === 0) {
        return group(["(", softline, softline, ")"]);
    }

    const parts: any[] = [];
    // Short-circuit: if simplePrefixLength <= 1 or there are no trailing args,
    // we know shouldForcePrefixBreaks will be false and can skip the array operations.
    const trailingArgsStart = simplePrefixLength < args.length ? simplePrefixLength : -1;
    let shouldForcePrefixBreaks = false;

    if (simplePrefixLength > 1 && trailingArgsStart !== -1) {
        const trailingArguments = args.slice(trailingArgsStart);
        const firstCallbackIndex = trailingArguments.findIndex(isCallbackArgument);
        shouldForcePrefixBreaks =
            firstCallbackIndex !== -1 &&
            trailingArguments.slice(firstCallbackIndex + 1).some((argument: any) => !isCallbackArgument(argument));
    }

    for (let index = 0; index < args.length; index++) {
        parts.push(path.call(print, "arguments", index));

        if (index >= args.length - 1) {
            continue;
        }

        parts.push(",");

        if (index < simplePrefixLength - 1 && !shouldForcePrefixBreaks) {
            parts.push(" ");
            continue;
        }

        parts.push(line);
    }

    const argumentGroup = group(["(", indent([softline, ...parts]), softline, ")"]);

    return shouldForcePrefixBreaks ? concat([breakParent, argumentGroup]) : argumentGroup;
}
