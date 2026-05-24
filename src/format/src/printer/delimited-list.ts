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
 * Inline check for trailing comment tokens in a doc structure.
 *
 * Returns true when the last item in `doc` contains a trailing comment token
 * (a `//` or `/*` string in the final nested array). Checks inline to avoid
 * circular imports from expression-print-utils.
 *
 * @param doc - The doc structure to inspect.
 * @returns `true` if the doc has a trailing comment token, `false` otherwise.
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
 * Checks if trailing commas should be allowed based on the Prettier options.
 *
 * Trailing commas are allowed when `options.trailingComma` is set to
 * `TRAILING_COMMA.ALL`, which enables trailing commas in all lists.
 *
 * @param options - Prettier formatting options.
 * @returns `true` if trailing commas are permitted, `false` otherwise.
 */
export function shouldAllowTrailingComma(options: any): boolean {
    return options?.trailingComma === TRAILING_COMMA.ALL;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Prints a delimited list of AST elements (e.g., function arguments, array
 * items, struct properties) with configurable delimiter, spacing, and
 * line-breaking behavior.
 *
 * @param path - The AST path for traversal.
 * @param print - The Prettier print callback.
 * @param listKey - Property name on the current node containing the element array.
 * @param startChar - Opening delimiter (e.g., `"("`, `"["`).
 * @param endChar - Closing delimiter (e.g., `")"`, `"]"`).
 * @param overrides - Optional settings for delimiter, padding, line breaks, and grouping.
 * @returns A Prettier doc group for the delimited list.
 */
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

/**
 * Prints a comma-separated list of AST elements.
 *
 * This is a convenience wrapper around {@link printDelimitedList} that
 * hardcodes the delimiter to `,` and derives the `allowTrailingDelimiter`
 * setting from the Prettier options.
 *
 * @param path - The AST path for traversal.
 * @param print - The Prettier print callback.
 * @param listKey - Property name on the current node containing the element array.
 * @param startChar - Opening delimiter (e.g., `"("`, `"["`).
 * @param endChar - Closing delimiter (e.g., `")"`, `"]"`).
 * @param options - Prettier formatting options (used to check `trailingComma`).
 * @param overrides - Optional settings passed through to {@link printDelimitedList}.
 * @returns A Prettier doc group for the comma-separated list.
 */
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

/**
 * Iterates over the elements in a delimited list and prints each one.
 *
 * Handles trailing comment detection to place separators before comments
 * rather than after. Enforces `maxElementsPerLine` by inserting hardline
 * breaks when the limit is reached or a complex argument is encountered.
 *
 * @param path - The AST path for traversal.
 * @param print - The Prettier print callback.
 * @param listKey - Property name on the current node containing the element array.
 * @param delimiter - String to insert between elements (e.g., `","`).
 * @param lineBreak - Prettier doc to use for line breaks (usually `line` or `hardline`).
 * @param maxElementsPerLine - Maximum elements before forcing a break (default: `Infinity`).
 * @returns A Prettier doc array mapping each element to its printed form with separators.
 */
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

/**
 * Builds inline and multiline Prettier docs for call arguments.
 *
 * Selects the appropriate layout strategy based on argument composition:
 * - Pure callback arguments use standard multiline formatting
 * - Mixed simple-prefix + callback arguments use a specialized layout
 *   that breaks after the callback to avoid dangling-close-paren issues
 * - String literal arguments with simple prefix use compact formatting
 *
 * The returned `inlineDoc` is only populated when `includeInlineVariant`
 * is true and the argument list fits on a single line.
 *
 * @param path - The AST path for traversal.
 * @param print - The Prettier print callback.
 * @param options - Prettier formatting options.
 * @param opts - Layout options (`forceBreak`, `maxElementsPerLine`, etc.).
 * @returns An object with `inlineDoc` and `multilineDoc` Prettier docs.
 */
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

/**
 * Builds inline and multiline Prettier docs for function parameter lists.
 *
 * The inline doc is always compact (no newlines), while the multiline doc
 * indents elements and allows trailing commas. When `forceInline` is true,
 * both docs are identical (compact).
 *
 * @param path - The AST path for traversal.
 * @param print - The Prettier print callback.
 * @param options - Prettier formatting options.
 * @param overrides - Optional settings; `forceInline` forces both variants to be compact.
 * @returns An object with `inlineDoc` and `multilineDoc` Prettier docs.
 */
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

/**
 * Counts leading simple arguments in a call expression.
 *
 * Scans from the start of the argument list and stops at the first
 * non-simple argument. Used by `buildCallArgumentsDocs` to decide
 * whether to use the simple-prefix layout strategy.
 *
 * @param node - A call expression node with an `arguments` array.
 * @returns Number of consecutive leading simple arguments.
 */
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

/**
 * Builds a specialized call arguments doc for mixed simple-prefix + callback layouts.
 *
 * Renders arguments inline up to `simplePrefixLength`, then breaks to a new line
 * for the first callback and any arguments that follow it. This prevents dangling
 * close-paren issues where a callback closes on the same line as `)`.
 *
 * `shouldForcePrefixBreaks` is set when there are arguments after the first callback,
 * indicating that the break point should be propagated upward to force a full layout break.
 *
 * @param path - The AST path for traversal.
 * @param print - The Prettier print callback.
 * @param simplePrefixLength - Number of leading arguments to render inline (before callback).
 * @returns A Prettier doc group for the callback-argument layout.
 */
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
