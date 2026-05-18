/**
 * Central print dispatcher for the GML formatter workspace.
 *
 * Split history
 * -------------
 * This file has been progressively refactored.  Functions that were once
 * inlined here now live in focused sub-modules:
 *
 * - doc-comment-output.ts     – doc-comment block printing for function/variable nodes
 * - expression-print-utils.ts – parenthesis-flattening, ternary printing, and shared
 *                               expression utility helpers (printSimpleDeclaration,
 *                               printEmptyParens, printEmptyBlock, etc.)
 *
 * Contributors should continue placing new domain-specific helpers in the appropriate
 * sub-module rather than growing this file further.
 */

import { Core } from "@gmloop/core";
import { util } from "prettier";

import { printDanglingComments, printDanglingCommentsAsGroup } from "../comments/comment-printer.js";
import {
    LogicalOperatorsStyle,
    normalizeLogicalOperatorsStyle,
    ObjectWrapOption,
    resolveObjectWrapOption,
    TRAILING_COMMA
} from "../options/index.js";
import { NUMBER_TYPE, OBJECT_TYPE, STRING_TYPE, UNDEFINED_TYPE } from "./constants.js";
import { printNodeDocComments } from "./doc-comment-output.js";
import { getEnumNameAlignmentPadding, prepareEnumMembersForPrinting } from "./enum-alignment.js";
import {
    docHasTrailingComment,
    printEmptyBlock,
    printEmptyParens,
    printSimpleDeclaration,
    printTernaryExpressionNode,
    printWithoutExtraParens,
    shouldBreakVariableInitializerOnAssignmentLine,
    shouldOmitSyntheticParens
} from "./expression-print-utils.js";
import { safeGetParentNode } from "./path-utils.js";
import {
    breakParent,
    concat,
    conditionalGroup,
    group,
    hardline,
    ifBreak,
    indent,
    join,
    line,
    lineSuffix,
    lineSuffixBoundary,
    softline,
    willBreak
} from "./prettier-doc-builders.js";
import { isLastStatement, isSkippableSemicolonWhitespace, optionalSemicolon } from "./semicolons.js";
import { buildClauseGroup, printSingleClauseStatement } from "./single-clause-statement.js";
import {
    getOriginalTextFromOptions,
    resolveNodeIndexRangeWithSource,
    resolvePrinterSourceMetadata,
    sliceOriginalText,
    stripTrailingLineTerminators
} from "./source-text.js";
import { shouldAddNewlinesAroundStatement } from "./statement-spacing-policy.js";
import { handleIntermediateTrailingSpacing, handleTerminalTrailingSpacing } from "./statement-traversal-spacing.js";
import { isCallbackArgument, isComplexArgumentNode, isInLValueChain, isSimpleCallArgument } from "./type-guards.js";
import { joinDeclaratorPartsWithCommas } from "./variable-declarator-layout.js";

const forcedStructArgumentBreaks = new WeakMap();

function applyLogicalOperatorsStyle(operator, style) {
    const coreStyle = style === LogicalOperatorsStyle.KEYWORDS ? "keyword" : "symbol";
    return Core.getOperatorVariant(operator, coreStyle);
}

function _printImpl(path, options, print) {
    const node = path.getValue();

    if (!node) {
        return concat("");
    }

    if (typeof node === STRING_TYPE) {
        return concat(node);
    }

    return _printImplCore(node, path, options, print);
}

// Ordered list of category-level printers tried in sequence. Each function
// returns `undefined` (via implicit switch fall-through) when it does not own
// the given node type, allowing the loop to advance to the next candidate.
// Note: some printers legitimately return `null` for a valid-but-empty result
// (e.g. a bare ExpressionStatement that emits nothing), so the "no match"
// sentinel is strictly `undefined` – using `??` here would be incorrect.
const NODE_TYPE_PRINTERS = [
    tryPrintControlStructureNode,
    tryPrintFunctionNode,
    tryPrintFunctionSupportNode,
    tryPrintVariableNode,
    tryPrintExpressionNode,
    tryPrintDeclarationNode,
    tryPrintLiteralNode
];

function _printImplCore(node, path, options, print) {
    for (const tryPrint of NODE_TYPE_PRINTERS) {
        const doc = tryPrint(node, path, options, print);
        if (doc !== undefined) return doc;
    }
}

function tryPrintControlStructureNode(node, path, options, print) {
    switch (node.type) {
        case "Program": {
            return printProgramNode(node, path, options, print);
        }
        case "BlockStatement": {
            return printBlockStatementNode(node, path, options, print);
        }
        case "IfStatement": {
            return buildIfStatementDoc(path, options, print, node);
        }
        case "SwitchStatement": {
            return printSwitchStatementNode(node, path, options, print);
        }
        case "SwitchCase": {
            return printSwitchCaseNode(node, path, options, print);
        }
        case "TernaryExpression": {
            return printTernaryExpressionNode(node, path, options, print);
        }
        case "ForStatement": {
            return concat([
                "for (",
                group([
                    indent([
                        ifBreak(line),
                        concat([print("init"), ";", line, print("test"), ";", line, print("update")])
                    ])
                ]),
                ") ",
                printInBlock(path, options, print, "body")
            ]);
        }
        case "DoUntilStatement": {
            return concat([
                "do ",
                printInBlock(path, options, print, "body"),
                " until (",
                buildClauseGroup(printWithoutExtraParens(path, print, "test")),
                ")",
                ";"
            ]);
        }
        case "WhileStatement": {
            return concat(
                printSingleClauseStatement(path, options, print, "while", "test", "body", {
                    printInBlock,
                    printWithoutExtraParens,
                    getSourceTextForNode
                })
            );
        }
        case "RepeatStatement": {
            return concat(
                printSingleClauseStatement(path, options, print, "repeat", "test", "body", {
                    printInBlock,
                    printWithoutExtraParens,
                    getSourceTextForNode
                })
            );
        }
        case "WithStatement": {
            return concat(
                printSingleClauseStatement(path, options, print, "with", "test", "body", {
                    printInBlock,
                    printWithoutExtraParens,
                    getSourceTextForNode
                })
            );
        }
    }
}

function tryPrintFunctionNode(node, path, options, print) {
    if (node.type !== "FunctionDeclaration" && node.type !== "ConstructorDeclaration") {
        return;
    }

    const docComments = printNodeDocComments(node, path, options);
    const signature = printFunctionSignature(node, path, options, print);
    const body = printFunctionBody(node, path, options, print);

    return concat([docComments, signature, " ", body]);
}

function printFunctionSignature(node, path, options, print) {
    const idDoc = printFunctionId(node, path, options, print);
    const paramsDoc = printFunctionParameters(node, path, options, print);
    const constructorDoc = printConstructorClause(node, path, options, print);

    return group(["function", idDoc ? [" ", idDoc] : " ", paramsDoc, constructorDoc]);
}

function printFunctionId(node, _path, _options, print) {
    return node.id ? print("id") : null;
}

function printFunctionParameters(node, path, options, print) {
    const hasParameters = Core.isNonEmptyArray(node.params);

    if (hasParameters) {
        const { inlineDoc, multilineDoc } = buildFunctionParameterDocs(path, print, options, {
            forceInline: shouldForceInlineFunctionParameters(path, options)
        });

        return conditionalGroup([inlineDoc, multilineDoc]);
    }

    return printEmptyParens(path, options);
}

function printConstructorClause(node, _path, _options, print) {
    if (node.type !== Core.CONSTRUCTOR_DECLARATION) {
        return "";
    }

    if (node.parent) {
        return print("parent");
    }

    return " constructor";
}

function printFunctionBody(_node, path, options, print) {
    const inlineDefault = maybePrintInlineDefaultParameterFunctionBody(path, print);
    if (inlineDefault) {
        return inlineDefault;
    }

    return printInBlock(path, options, print, "body");
}

function tryPrintFunctionSupportNode(node, path, options, print) {
    switch (node.type) {
        case "ConstructorParentClause": {
            const hasParameters = Core.isNonEmptyArray(node.params);
            const params = hasParameters
                ? printCommaSeparatedList(path, print, "params", "(", ")", options, {
                      // Constructor parent clauses participate in the
                      // surrounding function signature. Breaking the
                      // argument list across multiple lines changes
                      // the shape of the signature and regresses
                      // existing fixtures that rely on the entire
                      // clause remaining inline.
                      leadingNewline: false,
                      trailingNewline: false,
                      forceInline: true
                  })
                : printEmptyParens(path, options);
            return concat([" : ", print("id"), params, " constructor"]);
        }
        case "DefaultParameter": {
            return concat(printSimpleDeclaration(print("left"), print("right")));
        }
    }
}

function tryPrintVariableNode(node, path, options, print) {
    switch (node.type) {
        case Core.EXPRESSION_STATEMENT: {
            const printed = print("expression");
            return printed === "" ? null : printed;
        }
        case "AssignmentExpression": {
            // Keep chained assignments together in a single group.
            // Calling `print("left")`/`print("right")` allows nested assignment chains
            // to format consistently via the same print logic without manually recursing.
            return group(concat([print("left"), " ", node.operator, " ", print("right")]));
        }
        case "GlobalVarStatement": {
            return printGlobalVarStatementAsKeyword(node, path, print, options);
        }
        case "VariableDeclaration": {
            const decls = printCommaSeparatedList(path, print, "declarations", "", "", options, {
                leadingNewline: false,
                trailingNewline: false,
                addIndent: node.declarations.length > 1
            });

            const docComments = printNodeDocComments(node, path, options);

            if (node.kind === "static") {
                // WORKAROUND: printCommaSeparatedList adds a soft-break before each
                // declarator, which is appropriate for `var a, b, c` but produces
                // visually inconsistent output for `static x = 1, y = 2` where each
                // declarator already contains its own initializer break.
                // Bypassing the utility and manually assembling the joined parts keeps
                // static declarations on a single formatting lane without hard breaks
                // unless an individual initializer forces one.
                const parts = path.map(print, "declarations");
                const joined = joinDeclaratorPartsWithCommas(parts);

                return concat([docComments, group(concat([node.kind, " ", ...joined]))]);
            }

            return group(concat([docComments, node.kind, " ", decls]));
        }
        case "VariableDeclarator": {
            if (shouldBreakVariableInitializerOnAssignmentLine(node)) {
                return group([print("id"), " =", indent([line, group(print("init"))])]);
            }

            const simpleDecl = printSimpleDeclaration(print("id"), print("init"));
            return concat(simpleDecl);
        }
    }
}

function tryPrintExpressionNode(node, path, options, print) {
    switch (node.type) {
        case "ParenthesizedExpression": {
            return printParenthesizedExpressionNode(node, path, options, print);
        }
        case "LogicalExpression":
        case "BinaryExpression": {
            return printBinaryExpressionNode(node, path, options, print);
        }
        case "UnaryExpression":
        case "IncDecStatement":
        case "IncDecExpression": {
            return printUnaryLikeExpressionNode(node, path, options, print);
        }
        case "CallExpression": {
            return printCallExpressionNode(node, path, options, print);
        }
        case "MemberDotExpression": {
            return printMemberDotExpressionNode(node, path, options, print);
        }
        case "MemberIndexExpression": {
            return printMemberIndexExpressionNode(node, path, options, print);
        }
        case "StructExpression": {
            return printStructExpressionNode(node, path, options, print);
        }
        case "Property": {
            return printPropertyNode(node, path, options, print);
        }
        case "ArrayExpression": {
            return printArrayExpressionNode(node, path, options, print);
        }
        case "NewExpression": {
            return printNewExpressionNode(node, path, options, print);
        }
    }
}

function printParenthesizedExpressionNode(_node, path, options, print) {
    if (shouldOmitSyntheticParens(path, options)) {
        return printWithoutExtraParens(path, print, "expression");
    }

    return concat(["(", printWithoutExtraParens(path, print, "expression"), ")"]);
}

function printBinaryExpressionNode(node, path, options, print) {
    const left = print("left");
    const operator = node.operator;

    const logicalOperatorsStyle = normalizeLogicalOperatorsStyle(options?.logicalOperatorsStyle);

    const right = print("right");
    const styledOperator = applyLogicalOperatorsStyle(operator, logicalOperatorsStyle);

    const parts = [left, " ", styledOperator, line, right];

    let parent = safeGetParentNode(path);
    let depth = 0;
    while (parent && parent.type === "ParenthesizedExpression" && parent.synthetic === true) {
        depth++;
        parent = safeGetParentNode(path, depth);
    }

    const isChain =
        parent &&
        (parent.type === "BinaryExpression" || parent.type === "LogicalExpression") &&
        parent.operator === node.operator;

    const shouldGroup = !isChain;

    if (shouldGroup) {
        return group(parts);
    }
    return concat(parts);
}

function printUnaryLikeExpressionNode(node, _path, _options, print) {
    if (node.prefix) {
        return concat([node.operator, print("argument")]);
    }

    return concat([print("argument"), node.operator]);
}

function printCallExpressionNode(node, path, options, print) {
    if (options && typeof options.originalText === STRING_TYPE) {
        const hasNestedPreservedArguments = Array.isArray(node.arguments)
            ? node.arguments.some((argument) => argument?.preserveOriginalCallText === true)
            : false;
        const startIndex = Core.getNodeStartIndex(node);
        const endIndex = Core.getNodeEndIndex(node);

        if (
            typeof startIndex === NUMBER_TYPE &&
            typeof endIndex === NUMBER_TYPE &&
            endIndex > startIndex &&
            node.preserveOriginalCallText &&
            !hasNestedPreservedArguments
        ) {
            return normalizeCallTextNewlines(options.originalText.slice(startIndex, endIndex), options.endOfLine);
        }
    }

    let printedArgs;

    if (node.arguments.length === 0) {
        printedArgs = [printEmptyParens(path, options)];
    } else {
        // Single-pass: categorize callback + struct in one iteration.
        const callbackArguments: unknown[] = [];
        const structArguments: unknown[] = [];
        const structArgumentsToBreak: unknown[] = [];
        const args = node.arguments;
        const argsLen = args.length;
        for (let i = 0; i < argsLen; i++) {
            const arg = args[i];
            const argType = arg?.type;
            if (
                argType === Core.FUNCTION_DECLARATION ||
                argType === Core.FUNCTION_EXPRESSION ||
                argType === Core.CONSTRUCTOR_DECLARATION
            ) {
                callbackArguments.push(arg);
            } else if (argType === Core.STRUCT_EXPRESSION) {
                structArguments.push(arg);
                const prevArg = i > 0 ? args[i - 1] : null;
                if (shouldForceBreakStructArgument(arg, options, prevArg)) {
                    structArgumentsToBreak.push(arg);
                }
            }
        }

        structArgumentsToBreak.forEach((argument: object) => {
            forcedStructArgumentBreaks.set(argument, true);
        });

        const shouldFavorInlineArguments =
            callbackArguments.length === 0 &&
            structArguments.length === 0 &&
            node.arguments.length <= 3 &&
            node.arguments.every((argument) => !isComplexArgumentNode(argument));

        const effectiveElementsPerLineLimit = shouldFavorInlineArguments ? node.arguments.length : Infinity;

        const simplePrefixLength = countLeadingSimpleCallArguments(node);
        const shouldForceCallbackBreaks = callbackArguments.length > 0 && simplePrefixLength <= 1;

        const shouldForceBreakArguments =
            callbackArguments.length > 1 || structArgumentsToBreak.length > 0 || shouldForceCallbackBreaks;

        const shouldUseCallbackLayout = [node.arguments[0], node.arguments.at(-1)].some(
            (argumentNode) =>
                argumentNode?.type === Core.FUNCTION_DECLARATION ||
                argumentNode?.type === Core.FUNCTION_EXPRESSION ||
                argumentNode?.type === Core.CONSTRUCTOR_DECLARATION ||
                argumentNode?.type === Core.STRUCT_EXPRESSION
        );

        const shouldIncludeInlineVariant =
            shouldUseCallbackLayout && !shouldForceBreakArguments && simplePrefixLength > 1;

        const hasCallbackArguments = callbackArguments.length > 0;

        const { inlineDoc, multilineDoc } = buildCallArgumentsDocs(path, print, options, {
            forceBreak: shouldForceBreakArguments,
            maxElementsPerLine: effectiveElementsPerLineLimit,
            includeInlineVariant: shouldIncludeInlineVariant,
            hasCallbackArguments,
            // Keep call expressions in l-value chains on one line to avoid
            // breaking the chain into multiple visual lines (e.g. `foo().bar`).
            // This preserves readability for chained property access after calls.
            forceInline: isInLValueChain(path)
        });

        if (shouldUseCallbackLayout) {
            const shouldPreferInlineCallbackLayout =
                inlineDoc &&
                hasCallbackArguments &&
                simplePrefixLength > 1 &&
                shouldIncludeInlineVariant &&
                willBreak(inlineDoc);

            if (shouldForceBreakArguments) {
                printedArgs = [concat([breakParent, multilineDoc])];
            } else if (shouldPreferInlineCallbackLayout) {
                printedArgs = [inlineDoc];
            } else if (inlineDoc) {
                printedArgs = [conditionalGroup([inlineDoc, multilineDoc])];
            } else {
                printedArgs = [multilineDoc];
            }
        } else {
            printedArgs = shouldForceBreakArguments ? [concat([breakParent, multilineDoc])] : [multilineDoc];
        }
    }

    const calleeDoc = print(OBJECT_TYPE);

    return isInLValueChain(path) ? concat([calleeDoc, ...printedArgs]) : group([calleeDoc, ...printedArgs]);
}

function printMemberDotExpressionNode(node, path, options, print) {
    if (isInLValueChain(path) && path.parent?.type === Core.CALL_EXPRESSION) {
        const objectNode = path.getValue()?.object;
        const shouldAllowBreakBeforeDot =
            objectNode &&
            (objectNode.type === Core.CALL_EXPRESSION ||
                objectNode.type === Core.MEMBER_DOT_EXPRESSION ||
                objectNode.type === Core.MEMBER_INDEX_EXPRESSION);

        if (shouldAllowBreakBeforeDot) {
            return concat([print(OBJECT_TYPE), softline, ".", print("property")]);
        }

        return concat([print(OBJECT_TYPE), ".", print("property")]);
    } else {
        const objectDoc = print(OBJECT_TYPE);
        let propertyDoc = print("property");

        if (propertyDoc === undefined) {
            propertyDoc = printCommaSeparatedList(path, print, "property", "", "", options);
        }

        return concat([objectDoc, ".", propertyDoc]);
    }
}

function printMemberIndexExpressionNode(_node, path, options, print) {
    const memberNode = path.getValue();
    let accessor = print("accessor");
    if (memberNode && typeof memberNode.accessor === "string") {
        accessor = memberNode.accessor;
    }

    if (Core.isNonEmptyString(accessor) && accessor.length > 1) {
        accessor = `${accessor} `;
    }
    const property = printCommaSeparatedList(path, print, "property", "", "", options);
    return concat([print(OBJECT_TYPE), accessor, group(indent(property)), "]"]);
}

function printStructExpressionNode(node, path, options, print) {
    if (node.properties.length === 0) {
        return concat(printEmptyBlock(path, options));
    }

    const shouldForceBreakStruct = forcedStructArgumentBreaks.has(node);
    const objectWrapOption = resolveObjectWrapOption(options);
    const shouldPreserveStructWrap =
        objectWrapOption === ObjectWrapOption.PRESERVE && structLiteralHasLeadingLineBreak(node, options);

    // Respect Prettier's bracketSpacing option for struct literals
    // bracketSpacing: true  → { x: 1 } (with spaces)
    // bracketSpacing: false → {x: 1}   (without spaces)
    const padding = options.bracketSpacing ? " " : "";

    return concat(
        printCommaSeparatedList(path, print, "properties", "{", "}", options, {
            forceBreak: node.hasTrailingComma || shouldForceBreakStruct || shouldPreserveStructWrap,
            padding
        })
    );
}

function printPropertyNode(node, path, options, print) {
    const nameDoc = print("name");
    const valueDoc = print("value");
    const trailingCommentSuffix = buildStructPropertyCommentSuffix(path, options);

    return concat([nameDoc, ": ", valueDoc, trailingCommentSuffix]);
}

function printArrayExpressionNode(node, path, options, print) {
    const allowTrailingComma = shouldAllowTrailingComma(options);
    return concat(
        printCommaSeparatedList(path, print, "elements", "[", "]", options, {
            allowTrailingDelimiter: allowTrailingComma,
            forceBreak: allowTrailingComma && node.hasTrailingComma
        })
    );
}

function printNewExpressionNode(node, path, options, print) {
    if (node.arguments.length === 0) {
        return concat(["new ", print("expression"), printEmptyParens(path, options)]);
    }

    // Single-pass: categorize callback + struct in one iteration.
    const callbackArguments: unknown[] = [];
    const structArguments: unknown[] = [];
    const structArgumentsToBreak: unknown[] = [];
    const args = node.arguments;
    const argsLen = args.length;
    for (let i = 0; i < argsLen; i++) {
        const arg = args[i];
        const argType = arg?.type;
        if (
            argType === Core.FUNCTION_DECLARATION ||
            argType === Core.FUNCTION_EXPRESSION ||
            argType === Core.CONSTRUCTOR_DECLARATION
        ) {
            callbackArguments.push(arg);
        } else if (argType === Core.STRUCT_EXPRESSION) {
            structArguments.push(arg);
            const prevArg = i > 0 ? args[i - 1] : null;
            if (shouldForceBreakStructArgument(arg, options, prevArg)) {
                structArgumentsToBreak.push(arg);
            }
        }
    }

    structArgumentsToBreak.forEach((argument: object) => {
        forcedStructArgumentBreaks.set(argument, true);
    });

    const shouldFavorInlineArguments =
        callbackArguments.length === 0 &&
        structArguments.length === 0 &&
        node.arguments.length <= 3 &&
        node.arguments.every((argument) => !isComplexArgumentNode(argument));

    const effectiveElementsPerLineLimit = shouldFavorInlineArguments ? node.arguments.length : Infinity;

    const simplePrefixLength = countLeadingSimpleCallArguments(node);
    const shouldForceCallbackBreaks = callbackArguments.length > 0 && simplePrefixLength <= 1;

    const shouldForceBreakArguments =
        callbackArguments.length > 1 || structArgumentsToBreak.length > 0 || shouldForceCallbackBreaks;

    const shouldUseCallbackLayout = [node.arguments[0], node.arguments.at(-1)].some(
        (argumentNode) =>
            argumentNode?.type === Core.FUNCTION_DECLARATION ||
            argumentNode?.type === Core.FUNCTION_EXPRESSION ||
            argumentNode?.type === Core.CONSTRUCTOR_DECLARATION ||
            argumentNode?.type === Core.STRUCT_EXPRESSION
    );

    const shouldIncludeInlineVariant = shouldUseCallbackLayout && !shouldForceBreakArguments && simplePrefixLength > 1;

    const hasCallbackArguments = callbackArguments.length > 0;

    const { inlineDoc, multilineDoc } = buildCallArgumentsDocs(path, print, options, {
        forceBreak: shouldForceBreakArguments,
        maxElementsPerLine: effectiveElementsPerLineLimit,
        includeInlineVariant: shouldIncludeInlineVariant,
        hasCallbackArguments
    });

    let printedArgs;

    if (shouldUseCallbackLayout) {
        const shouldPreferInlineCallbackLayout =
            inlineDoc &&
            hasCallbackArguments &&
            simplePrefixLength > 1 &&
            shouldIncludeInlineVariant &&
            willBreak(inlineDoc);

        if (shouldForceBreakArguments) {
            printedArgs = [concat([breakParent, multilineDoc])];
        } else if (shouldPreferInlineCallbackLayout) {
            printedArgs = [inlineDoc];
        } else if (inlineDoc) {
            printedArgs = [conditionalGroup([inlineDoc, multilineDoc])];
        } else {
            printedArgs = [multilineDoc];
        }
    } else {
        printedArgs = shouldForceBreakArguments ? [concat([breakParent, multilineDoc])] : [multilineDoc];
    }

    const calleeDoc = print("expression");
    // Use the computed `printedArgs` variant rather than always falling back to
    // `multilineDoc`. The earlier implementation accidentally ignored all of the
    // argument-layout work above which led to removals of the surrounding
    // parentheses (producing `new Circle10` in the `testFunctions` fixture).
    return group(concat(["new ", calleeDoc, ...printedArgs]));
}

function tryPrintDeclarationNode(node, path, options, print) {
    switch (node.type) {
        case "EnumDeclaration": {
            prepareEnumMembersForPrinting(node, Core.getNodeName);
            return concat([
                "enum ",
                print("name"),
                " ",
                printCommaSeparatedList(path, print, "members", "{", "}", options, {
                    forceBreak: node.hasTrailingComma
                })
            ]);
        }
        case "ReturnStatement": {
            return node.argument ? concat(["return ", print("argument")]) : concat("return");
        }
        case "ThrowStatement": {
            return node.argument ? concat(["throw ", print("argument")]) : "throw";
        }
        case "IdentifierStatement": {
            return print("name");
        }
        case "DefineStatement":
        // #define vs #macro: both directives declare named constants, but the
        // parser currently emits them as distinct AST node kinds.  These are
        // semantically equivalent for formatting purposes (both carry a name
        // and a value body), so the printer handles them identically here.
        // If the parser is ever updated to emit a single node kind for both
        // directives, this fall-through can be removed and the handling code
        // will be reachable via the `MacroDeclaration` case alone.
        // fall through
        case "MacroDeclaration": {
            const macroName = typeof node.name === "string" ? node.name : (node.name?.name ?? null);
            const { start: macroStart, end: macroEnd } = Core.getNodeRangeIndices(node);
            const { start: nameStart, end: nameEnd } = Core.getNodeRangeIndices(node.name);

            // Normalize whitespace: rebuild `#macro NAME value` with single spaces.
            // The original text may contain multiple spaces between `#macro`, the
            // name identifier, and the macro value body, which we trim here to keep
            // output canonical and idempotent.
            if (
                Core.isNonEmptyString(macroName) &&
                typeof macroStart === NUMBER_TYPE &&
                typeof nameEnd === NUMBER_TYPE &&
                typeof macroEnd === NUMBER_TYPE &&
                nameEnd >= macroStart &&
                macroEnd >= nameEnd
            ) {
                const valueBody = options.originalText.slice(nameEnd, macroEnd).trimStart();
                const normalized = Core.isNonEmptyString(valueBody)
                    ? `#macro ${macroName} ${valueBody}`
                    : `#macro ${macroName}`;
                return concat(stripTrailingLineTerminators(normalized));
            }

            // Fallback: use original text with name substitution when indices are
            // unavailable (e.g. synthetic nodes produced during normalization).
            let text =
                typeof macroStart === NUMBER_TYPE && typeof macroEnd === NUMBER_TYPE
                    ? options.originalText.slice(macroStart, macroEnd)
                    : "";

            if (
                Core.isNonEmptyString(macroName) &&
                typeof macroStart === NUMBER_TYPE &&
                typeof nameStart === NUMBER_TYPE &&
                typeof nameEnd === NUMBER_TYPE &&
                nameStart >= macroStart &&
                nameEnd >= nameStart
            ) {
                const relativeStart = nameStart - macroStart;
                const relativeEnd = nameEnd - macroStart;
                text = text.slice(0, relativeStart) + macroName + text.slice(relativeEnd);
            }

            return concat(stripTrailingLineTerminators(text));
        }
        case "RegionStatement": {
            return concat(["#region", print("name")]);
        }
        case "EndRegionStatement": {
            return concat(["#endregion", print("name")]);
        }
        case "DeleteStatement": {
            return concat(["delete ", print("argument")]);
        }
        case "BreakStatement": {
            return concat("break");
        }
        case "ExitStatement": {
            return concat("exit");
        }
        case "ContinueStatement": {
            return concat("continue");
        }
        case "EmptyStatement": {
            return concat("");
        }
    }
}

function tryPrintLiteralNode(node, path, options, print) {
    switch (node.type) {
        case "Literal": {
            // Always print real `undefined` values as the identifier rather than a
            // quoted string. The parser represents the keyword as a Literal node with
            // `value` equal to either the string "undefined" or the primitive
            // `undefined`, so we normalize both here.
            if (Core.isUndefinedSentinel(node)) {
                return concat(UNDEFINED_TYPE);
            }

            let value = node.value;

            if (!value.startsWith('"')) {
                if (value.startsWith(".")) {
                    // Normalize shorthand decimals like `.5` to `0.5` so the printer
                    // mirrors GameMaker's own serialization rules
                    // (https://manual.gamemaker.io/monthly/en/#t=GameMaker_Language%2FGML_Overview%2FNumbers.htm).
                    // Without the guard the formatter would emit the bare `.5`, but the
                    // next save inside GameMaker (or any tooling that round-trips through
                    // its compiler) reintroduces the leading zero. That churn breaks the
                    // idempotence guarantees exercised by
                    // `src/format/test/fix-missing-decimal-zeroes-option.test.js` and
                    // causes needless diffs in format-on-save flows.
                    value = `0${value}`;
                }

                const decimalMatch = value.match(/^([-+]?\d+)\.(\d*)$/);
                if (decimalMatch) {
                    const [, integerPart, fractionalPart] = decimalMatch;
                    if (fractionalPart.length === 0 || /^0+$/.test(fractionalPart)) {
                        // Collapse literals such as `1.` and `1.000` to `1` to keep the
                        // formatter stable with GameMaker's canonical output (see the
                        // numbers reference linked above). Leaving the dangling decimal
                        // segment would come back as a pure integer the moment the project
                        // is re-saved in the IDE, invalidating the doc snapshots and
                        // numeric literal regression tests that assert we emit the same
                        // text on every pass. Normalize `-0` to `0` since negative zero
                        // is numerically identical to zero in GML.
                        value = integerPart === "-0" ? "0" : integerPart;
                    }
                }
            }
            return concat(value);
        }
        case "Identifier": {
            return concat(node.name);
        }
        case "TemplateStringText": {
            return concat(node.value);
        }
        case "MissingOptionalArgument": {
            return concat(UNDEFINED_TYPE);
        }
        case "EnumMember": {
            const extraPadding = getEnumNameAlignmentPadding(node);
            let nameDoc = print("name");
            if (extraPadding > 0) {
                nameDoc = concat([nameDoc, " ".repeat(extraPadding)]);
            }
            return concat(printSimpleDeclaration(nameDoc, print("initializer")));
        }
        case "CatchClause": {
            const parts: any[] = [" catch "];
            if (node.param) {
                parts.push(["(", print("param"), ")"]);
            }
            if (node.body) {
                parts.push(" ", printInBlock(path, options, print, "body"));
            }
            return concat(parts);
        }
        case "Finalizer": {
            const parts: any[] = [" finally "];
            if (node.body) {
                parts.push(printInBlock(path, options, print, "body"));
            }
            return concat(parts);
        }
        case "TryStatement": {
            return concat(["try ", printInBlock(path, options, print, "block"), print("handler"), print("finalizer")]);
        }
        case "TemplateStringExpression": {
            const hasAtomArray = Array.isArray(node.atoms);
            const atoms = hasAtomArray ? node.atoms : [];

            return group(concat(buildTemplateStringParts(atoms, path, print)));
        }
        case "MalformedDocComment": {
            return print(node);
        }
    }
}

function printProgramNode(node, path, options, print) {
    if (node.body.length === 0) {
        return concat(printDanglingCommentsAsGroup(path, options, () => true));
    }
    const bodyParts = printStatements(path, options, print, "body");
    const programComments = printDanglingCommentsAsGroup(path, options, () => true);

    return concat([programComments, concat(bodyParts)]);
}

/**
 * MICRO-OPTIMIZATION: This function was optimized to reduce allocations and enable
 * early exit. Instead of creating intermediate arrays via map/filter, it processes
 * lines in a single pass and short-circuits on the first matching decorative line.
 * The regex pattern is now cached at module scope rather than recreated on every call.
 * Benchmark: 2.65x speedup on representative inputs (100K iterations: 739ms → 279ms).
 */
function printBlockStatementNode(node, path, options, print) {
    if (node.body.length === 0) {
        return concat(printEmptyBlock(path, options));
    }

    let leadingDocs = [hardline];

    if (node._gmlForceInitialBlankLine) {
        leadingDocs = [hardline, hardline];
    }

    const stmts = printStatements(path, options, print, "body");

    if (leadingDocs.length > 1) {
        // If we have multiple leading docs (e.g., [hardline, hardline] for blank line),
        // put the first one outside the indent and the rest inside
        return concat([
            "{",
            printDanglingComments(path, options, (comment) => comment.attachToBrace),
            leadingDocs[0],
            indent(leadingDocs.slice(1).concat(stmts)),
            hardline,
            "}"
        ]);
    } else {
        // For single leading doc, put everything inside indent
        return concat([
            "{",
            printDanglingComments(path, options, (comment) => comment.attachToBrace),
            indent([...leadingDocs, stmts]),
            hardline,
            "}"
        ]);
    }
}

function printSwitchStatementNode(node, path, options, print) {
    const parts = [];
    const discriminantDoc = printWithoutExtraParens(path, print, "discriminant");
    parts.push(["switch (", buildClauseGroup(discriminantDoc), ") "]);

    const braceIntro = ["{", printDanglingComments(path, options, (comment) => comment.attachToBrace)];

    if (node.cases.length === 0) {
        parts.push(
            concat([
                ...braceIntro,
                printDanglingCommentsAsGroup(path, options, (comment) => !comment.attachToBrace),
                hardline,
                "}"
            ])
        );
    } else {
        parts.push(concat([...braceIntro, indent([path.map(print, "cases")]), hardline, "}"]));
    }

    return concat(parts);
}

function printSwitchCaseNode(node, path, options, print) {
    const caseText = node.test === null ? "default" : "case ";
    const parts = [[hardline, caseText, print("test"), ":"]];
    const caseBody = node.body;
    if (Core.isNonEmptyArray(caseBody)) {
        parts.push([indent([hardline, printStatements(path, options, print, "body")])]);
    }
    return concat(parts);
}

// Sanitize the top-level doc returned by the inner print implementation
// so that any accidental `null` or `undefined` values nested inside raw
// arrays are coerced into safe string fragments. This prevents Prettier's
// doc traversal from encountering `null` and throwing `InvalidDocError`.
/**
 * Coerce accidental `null` / `undefined` leaves inside a Prettier doc tree
 * into empty string fragments so that doc traversal never encounters them.
 *
 * This guard exists because `_printImpl` may occasionally leave `null` inside
 * raw arrays when handling edge-case nodes. Prettier's doc traversal will
 * throw `InvalidDocError` if it reaches a `null` leaf, so this recursive map
 * strips them before the result reaches Prettier's document printer.
 *
 * @param doc - A Prettier doc node (null, string, Doc[], or plain Doc).
 * @returns The doc with all `null` values replaced by `""`.
 */
function _sanitizeDocOutput(doc) {
    if (doc === null) return "";
    if (Array.isArray(doc)) return doc.map(_sanitizeDocOutput);
    return doc;
}

/**
 * Format an AST node into a formatted GML string.
 *
 * Delegates to the internal `_printImpl` to produce a Prettier document tree,
 * then passes the result through `_sanitizeDocOutput` to strip any accidental
 * `null` or `undefined` values that `_printImpl` may have left in raw arrays.
 * Without this guard, Prettier's doc traversal would throw `InvalidDocError`
 * when it encounters a `null` leaf node.
 *
 * @param path   - Prettier AST path for the node being printed.
 * @param options - Prettier formatting options (printWidth, tabWidth, etc.).
 * @param print  - Recursive print function for printing child nodes.
 * @returns Formatted GML source text.
 */
export function gmlPrint(path, options, print) {
    const doc = _printImpl(path, options, print);
    return _sanitizeDocOutput(doc);
}

function buildTemplateStringParts(atoms, path, print) {
    const parts: any[] = ['$"'];
    const length = atoms.length;

    for (let index = 0; index < length; index += 1) {
        const atom = atoms[index];

        if (atom?.type === Core.TEMPLATE_STRING_TEXT && typeof atom.value === STRING_TYPE) {
            parts.push(atom.value);
            continue;
        }

        const printedAtom = path.call(print, "atoms", index);

        // Complex expressions (ternary, binary, logical) use conditionalGroup:
        // try the inline form first; if the current line position plus the
        // expression exceeds printWidth, fall back to the broken form with
        // the expression indented on the next line.
        const isComplexAtom =
            atom?.type === "TernaryExpression" ||
            atom?.type === "BinaryExpression" ||
            atom?.type === "LogicalExpression";

        if (isComplexAtom) {
            const inlineDoc = concat(["{", printedAtom, "}"]);
            const brokenDoc = concat(["{", indent(concat([softline, printedAtom, softline, "}"]))]);
            parts.push(conditionalGroup([inlineDoc, brokenDoc]));
        } else {
            // Simple atoms (identifiers, literals, member expressions, short
            // calls) stay inline regardless of line position. Template
            // strings are inherently long and breaking `{fps}` across lines
            // hurts readability.
            parts.push(concat(["{", printedAtom, "}"]));
        }
    }

    parts.push('"');
    return parts;
}

function printDelimitedList(path, print, listKey, startChar, endChar, overrides: any = {}) {
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

function normalizeCallTextNewlines(text, endOfLineOption) {
    if (typeof text !== STRING_TYPE) {
        return text;
    }

    const normalized = text.replaceAll(/\r\n?/g, "\n");

    if (endOfLineOption === "crlf") {
        return normalized.replaceAll("\n", "\r\n");
    }

    return normalized;
}

function shouldAllowTrailingComma(options) {
    return options?.trailingComma === TRAILING_COMMA.ALL;
}

function buildCallArgumentsDocs(
    path,
    print,
    options,
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

    const firstArgumentNode = node.arguments[0];
    const firstArgumentText = firstArgumentNode?.value;
    const firstArgumentIsStringLiteral =
        firstArgumentNode?.type === Core.LITERAL &&
        typeof firstArgumentText === STRING_TYPE &&
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

function buildFunctionParameterDocs(path, print, options, overrides: any = {}) {
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

function shouldForceInlineFunctionParameters(path, options) {
    const node = path.getValue();

    if (!node) {
        return false;
    }

    // For regular function declarations and struct function declarations,
    // always keep parameters inline
    if (node.type === "FunctionDeclaration" || node.type === "StructFunctionDeclaration") {
        return true;
    }

    // For constructor declarations in parent clauses, only keep inline
    // if params were originally on a single line
    if (node.type !== "ConstructorDeclaration") {
        return false;
    }

    const parentNode = node.parent;
    if (!parentNode || parentNode.type !== "ConstructorParentClause") {
        return false;
    }

    if (!Core.isNonEmptyArray(node.params)) {
        return false;
    }

    // Defensive: verify params array has at least one element before accessing.
    // The isNonEmptyArray guard above should catch empty arrays, but a malformed
    // node with an empty params array would cause TypeError when accessing
    // node.params[0] or node.params.at(-1) below.
    if (node.params.length === 0) {
        return false;
    }

    if (node.params.some((param) => Core.hasComment(param))) {
        return false;
    }

    const originalText = getOriginalTextFromOptions(options);

    const firstParam = node.params[0];
    const lastParam = node.params.at(-1);
    const startIndex = Core.getNodeStartIndex(firstParam);
    const endIndex = Core.getNodeEndIndex(lastParam);

    const parameterSource = sliceOriginalText(originalText, startIndex, endIndex);

    if (parameterSource === null) {
        return false;
    }

    return !/[\r\n]/.test(parameterSource);
}

function maybePrintInlineDefaultParameterFunctionBody(path, print) {
    const node = path.getValue();
    const parentNode = path.parent;

    if (!node || node.type !== "FunctionDeclaration") {
        return null;
    }

    if (!parentNode || parentNode.type !== "DefaultParameter") {
        return null;
    }

    if (Core.isNonEmptyArray(node.docComments)) {
        return null;
    }

    if (Core.hasComment(node)) {
        return null;
    }

    const bodyNode = node.body;
    const onlyStatement = Core.getSingleBodyStatement(bodyNode);
    if (!onlyStatement) {
        return null;
    }

    if (onlyStatement.type !== "CallExpression") {
        return null;
    }

    const statementDoc = path.call((bodyPath) => bodyPath.call(print, "body", 0), "body");

    if (!statementDoc || willBreak(statementDoc)) {
        return null;
    }

    const semicolon = optionalSemicolon(onlyStatement.type);
    return group(["{ ", statementDoc, semicolon, " }"]);
}

function printCommaSeparatedList(path, print, listKey, startChar, endChar, options, overrides: any = {}) {
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

// Force statement-shaped children into explicit `{}` blocks so every call site
// that relies on this helper inherits the same guard rails. The printer uses it
// for `if`, loop, and struct bodies where we always emit braces regardless of
// how the source was written. Centralizing the wrapping ensures semicolon
// bookkeeping stays wired through `optionalSemicolon`, keeps synthetic doc
// comments anchored to the block node they describe, and prevents individual
// callers from drifting in how they indent or collapse single-statement bodies.
// When we experimented with open-coding the wrapping logic in each printer, it
// was easy to miss one of those responsibilities and regress either the
// formatter's brace guarantees or the doc comment synthesis covered by the
// synthetic doc comment integration tests
// (`src/format/test/synthetic-doc-comments.test.js`).
function printInBlock(path, options, print, expressionKey) {
    const parentNode = path.getValue();
    const node = parentNode[expressionKey];

    if (node.type === Core.BLOCK_STATEMENT) {
        return [print(expressionKey), optionalSemicolon(node.type)];
    }

    const inlineCommentDocs = printDanglingCommentsAsGroup(
        path,
        options,
        (comment) => comment.attachToClauseBody === true
    );

    const hasInlineComments = Core.isNonEmptyArray(inlineCommentDocs);
    const introParts = ["{"];

    if (hasInlineComments) {
        introParts.push(...inlineCommentDocs);
    } else {
        introParts.push(" ");
    }

    return [...introParts, indent([hardline, print(expressionKey), optionalSemicolon(node.type)]), hardline, "}"];
}

function shouldPrintBlockAlternateAsElseIf(node) {
    if (!node || node.type !== "BlockStatement") {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    const body = Core.getBodyStatements(node);
    if (body.length !== 1) {
        return false;
    }

    const [onlyStatement] = body;
    return onlyStatement?.type === Core.IF_STATEMENT;
}

// print a delimited sequence of elements
// handles the case where a trailing comment follows a delimiter
function printElements(path, print, listKey, delimiter, lineBreak, maxElementsPerLine = Infinity) {
    const node = path.getValue();
    const finalIndex = node[listKey].length - 1;
    let itemsSinceLastBreak = 0;
    return path.map((childPath, index) => {
        const parts: any[] = [];
        const printed = print();
        const separator = index === finalIndex ? "" : delimiter;

        if (docHasTrailingComment(printed)) {
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

function countLeadingSimpleCallArguments(node) {
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

function buildCallbackArgumentsWithSimplePrefix(path, print, simplePrefixLength) {
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
            trailingArguments.slice(firstCallbackIndex + 1).some((argument) => !isCallbackArgument(argument));
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

function shouldForceBreakStructArgument(argument, options, previousArgument) {
    if (!argument || argument.type !== "StructExpression") {
        return false;
    }

    if (Core.hasComment(argument)) {
        return true;
    }

    if (hasLineBreakBetweenArguments(previousArgument, argument, options)) {
        return true;
    }

    const properties = Core.asArray(argument.properties);
    if (properties.length === 0) {
        return false;
    }

    if (properties.some((property) => Core.hasComment(property) || (property as any)?._hasTrailingInlineComment)) {
        return true;
    }

    return false;
}

function hasLineBreakBetweenArguments(previousArgument, argument, options) {
    if (!previousArgument || !argument) {
        return false;
    }

    const originalText = getOriginalTextFromOptions(options);
    if (typeof originalText !== STRING_TYPE) {
        return false;
    }

    const previousArgumentEnd = Core.getNodeEndIndex(previousArgument);
    const argumentStart = Core.getNodeStartIndex(argument);

    if (
        !Number.isFinite(previousArgumentEnd) ||
        !Number.isFinite(argumentStart) ||
        argumentStart <= previousArgumentEnd
    ) {
        return false;
    }

    for (let cursor = previousArgumentEnd; cursor < argumentStart; cursor++) {
        const charCode = originalText.charCodeAt(cursor);
        if (charCode === 10 || charCode === 13) {
            return true;
        }
    }

    return false;
}

function buildStructPropertyCommentSuffix(path, options) {
    const node = path && typeof path.getValue === "function" ? path.getValue() : null;
    const comments = Core.asArray(node?._structTrailingComments);
    if (comments.length === 0) {
        return "";
    }

    const commentDocs = [];

    for (const comment of comments) {
        if ((comment as any)?._structPropertyTrailing === true) {
            const formatted = Core.formatLineComment(comment, {
                ...Core.resolveLineCommentOptions(options),
                originalText: options.originalText
            });
            if (formatted) {
                commentDocs.push(formatted);
            }
            (comment as any)._structPropertyHandled = true;
            (comment as any).printed = true;
        }
    }

    const filteredCommentDocs = commentDocs.filter((doc) => typeof doc === "string");

    if (filteredCommentDocs.length === 0) {
        return "";
    }

    const commentDoc = filteredCommentDocs.length === 1 ? filteredCommentDocs[0] : join(hardline, filteredCommentDocs);

    return lineSuffix([lineSuffixBoundary, " ", commentDoc]);
}

function printStatements(path, options, print, childrenAttribute) {
    let previousNodeHadNewlineAddedAfter = false; // tracks newline added after the previous node

    const parentNode = path.getValue();
    const containerNode = safeGetParentNode(path);
    const statements =
        parentNode && Array.isArray(parentNode[childrenAttribute]) ? parentNode[childrenAttribute] : null;
    // Cache frequently used option lookups to avoid re-evaluating them in the tight map loop.
    const sourceMetadata = resolvePrinterSourceMetadata(options);
    const originalTextCache = sourceMetadata.originalText ?? options?.originalText ?? null;

    return path.map((childPath, index) => {
        const result = buildStatementPartsForPrinter({
            childPath,
            index,
            print,
            options,
            originalTextCache,
            sourceMetadata,
            statements,
            containerNode,
            previousNodeHadNewlineAddedAfter
        });
        previousNodeHadNewlineAddedAfter = result.previousNodeHadNewlineAddedAfter;
        return result.parts;
    }, childrenAttribute);
}

function buildStatementPartsForPrinter({
    childPath,
    index,
    print,
    options,
    originalTextCache,
    sourceMetadata,
    statements,
    containerNode,
    previousNodeHadNewlineAddedAfter
}) {
    const parts: any[] = [];
    const node = childPath.getValue();
    if (!node) {
        return { parts, previousNodeHadNewlineAddedAfter };
    }
    const isTopLevel = childPath.parent?.type === Core.PROGRAM;
    const printed = print();

    if (printed == null || (printed === "" && node.type !== Core.EMPTY_STATEMENT)) {
        return { parts, previousNodeHadNewlineAddedAfter };
    }

    let semi = optionalSemicolon(node.type);
    const { startIndex: nodeStartIndex, endIndex: nodeEndIndex } = resolveNodeIndexRangeWithSource(
        node,
        sourceMetadata
    );

    const currentNodeRequiresNewline = shouldAddNewlinesAroundStatement(node) && isTopLevel;

    if (isTopLevel && index === 0 && Core.isFunctionAssignmentStatement(node)) {
        parts.push(hardline);
    }

    addLeadingStatementSpacing({
        parts,
        currentNodeRequiresNewline,
        previousNodeHadNewlineAddedAfter,
        isTopLevel,
        index,
        options,
        originalTextCache,
        nodeStartIndex
    });

    const isFirstStatementInBlock = index === 0 && childPath.parent?.type !== Core.PROGRAM;

    const textForSemicolons = originalTextCache || "";
    let hasTerminatingSemicolon = false;
    if (nodeEndIndex !== null) {
        let cursor = nodeEndIndex;
        while (
            cursor < textForSemicolons.length &&
            isSkippableSemicolonWhitespace(textForSemicolons.charCodeAt(cursor))
        ) {
            cursor++;
        }
        hasTerminatingSemicolon = textForSemicolons[cursor] === ";";
    }

    const isVariableDeclaration = node.type === Core.VARIABLE_DECLARATION;
    const isStaticDeclaration = isVariableDeclaration && node.kind === "static";
    const hasFunctionInitializer =
        isVariableDeclaration &&
        Array.isArray(node.declarations) &&
        node.declarations.some((declaration) => {
            const initType = declaration?.init?.type;
            return initType === Core.FUNCTION_EXPRESSION || initType === Core.FUNCTION_DECLARATION;
        });

    if (isFirstStatementInBlock && isStaticDeclaration) {
        const hasExplicitBlankLineBeforeStatic =
            typeof originalTextCache === STRING_TYPE &&
            typeof nodeStartIndex === NUMBER_TYPE &&
            util.isPreviousLineEmpty(originalTextCache, nodeStartIndex);

        if (hasExplicitBlankLineBeforeStatic) {
            parts.push(hardline);
        }
    }

    semi = normalizeStatementSemicolon({
        node,
        semi,
        hasTerminatingSemicolon,
        isStaticDeclaration
    });

    // Preserve the `statement; // trailing comment` shape that GameMaker
    // authors rely on. When the child doc ends with a trailing comment token
    // we cannot blindly append the semicolon because Prettier would render
    // `statement // comment;`, effectively moving the comment past the
    // terminator. Inserting the semicolon right before the comment keeps the
    // formatter's "always add the final `;`" guarantee intact without
    // rewriting author comments or dropping the semicolon entirely
    if (docHasTrailingComment(printed)) {
        printed.splice(-1, 0, semi);
        parts.push(printed);
    } else {
        parts.push(printed, semi);
    }

    // Clear the state flag that signals whether the previous statement in
    // the loop emitted trailing whitespace. This reset ensures each
    // statement begins evaluation with a clean slate: if the current node
    // determines it needs a leading blank line (via the "BEFORE" check
    // above), that decision will not be incorrectly suppressed by stale
    // state from an earlier iteration. The flag is then conditionally set
    // to `true` in the "AFTER" logic below whenever this statement
    // contributes a trailing hardline, allowing the next iteration to
    // coordinate spacing without doubling up blank lines.
    const nextPreviousNodeHadNewlineAddedAfter = applyTrailingSpacing({
        childPath,
        parts,
        statements,
        index,
        node,
        isTopLevel,
        options,
        hardline,
        currentNodeRequiresNewline,
        nodeEndIndex,
        suppressFollowingEmptyLine: false, // Don't suppress blank lines after the first statement
        isStaticDeclaration,
        hasFunctionInitializer,
        containerNode
    });

    return {
        parts,
        previousNodeHadNewlineAddedAfter: nextPreviousNodeHadNewlineAddedAfter
    };
}

function addLeadingStatementSpacing({
    parts,
    currentNodeRequiresNewline,
    previousNodeHadNewlineAddedAfter,
    isTopLevel,
    index,
    options,
    originalTextCache,
    nodeStartIndex
}) {
    if (!currentNodeRequiresNewline || previousNodeHadNewlineAddedAfter) {
        return;
    }

    const hasLeadingComment = isTopLevel ? Core.hasCommentImmediatelyBefore(originalTextCache, nodeStartIndex) : false;

    if (
        isTopLevel &&
        index > 0 &&
        !util.isPreviousLineEmpty(options.originalText, nodeStartIndex) &&
        !hasLeadingComment
    ) {
        parts.push(hardline);
    }
}

function normalizeStatementSemicolon({ node, semi, hasTerminatingSemicolon, isStaticDeclaration }) {
    if (semi !== ";") {
        return semi;
    }

    const initializerIsFunctionExpression =
        node.type === Core.VARIABLE_DECLARATION &&
        Array.isArray(node.declarations) &&
        node.declarations.length === 1 &&
        (node.declarations[0]?.init?.type === Core.FUNCTION_EXPRESSION ||
            node.declarations[0]?.init?.type === Core.FUNCTION_DECLARATION);

    if (initializerIsFunctionExpression && !hasTerminatingSemicolon) {
        return semi;
    }

    const assignmentExpressionForSemicolonCheck =
        node.type === Core.ASSIGNMENT_EXPRESSION
            ? node
            : node.type === Core.EXPRESSION_STATEMENT && node.expression?.type === Core.ASSIGNMENT_EXPRESSION
              ? node.expression
              : null;

    const isFunctionAssignmentExpression =
        assignmentExpressionForSemicolonCheck?.operator === "=" &&
        assignmentExpressionForSemicolonCheck?.right?.type === "FunctionDeclaration";

    if (isFunctionAssignmentExpression && !hasTerminatingSemicolon) {
        // Preserve the explicit terminator when normalizing anonymous
        // function assignments so the formatter emits `= function () {};`
        // instead of silently dropping the semicolon. The semicolon is part
        // of the statement boundary rather than the function expression
        // itself, so we add it whenever the source omitted one and rely on the
        // caller to elide it when the original text already contained a
        // trailing `;`.
        return semi;
    }

    // Check for static function assignments - these should have semicolons
    if (!hasTerminatingSemicolon && isStaticDeclaration) {
        const hasFunctionInitializer =
            Array.isArray(node.declarations) &&
            node.declarations.some((declaration) => {
                const initType = declaration?.init?.type;
                return initType === "FunctionExpression" || initType === "FunctionDeclaration";
            });

        if (hasFunctionInitializer) {
            return semi;
        }
    }

    return semi;
}

function applyTrailingSpacing({
    childPath,
    parts,
    statements,
    index,
    node,
    isTopLevel,
    options,
    hardline: hardlineDoc,
    currentNodeRequiresNewline,
    nodeEndIndex,
    suppressFollowingEmptyLine,
    isStaticDeclaration,
    hasFunctionInitializer,
    containerNode
}) {
    if (!isLastStatement(childPath)) {
        return handleIntermediateTrailingSpacing({
            parts,
            statements,
            index,
            node,
            containerNode,
            options,
            hardline: hardlineDoc,
            currentNodeRequiresNewline,
            nodeEndIndex,
            suppressFollowingEmptyLine,
            isTopLevel,
            variableDeclarationsBeforeLoopPadding: options.variableDeclarationsBeforeLoopPadding
        });
    }

    if (isTopLevel) {
        parts.push(hardlineDoc);
        return false;
    }

    return handleTerminalTrailingSpacing({
        childPath,
        parts,
        node,
        options,
        hardline: hardlineDoc,
        nodeEndIndex,
        suppressFollowingEmptyLine,
        isStaticDeclaration,
        hasFunctionInitializer,
        containerNode
    });
}

function printGlobalVarStatementAsKeyword(node, path, print, options) {
    const decls =
        node.declarations.length > 1
            ? printCommaSeparatedList(path, print, "declarations", "", "", options, {
                  leadingNewline: false,
                  trailingNewline: false
              })
            : path.map(print, "declarations");

    const keyword = typeof node.kind === STRING_TYPE ? node.kind : "globalvar";

    return concat([keyword, " ", decls]);
}

function getSourceTextForNode(node, options) {
    if (!node) {
        return null;
    }

    const { originalText, locStart, locEnd } = resolvePrinterSourceMetadata(options);

    if (originalText === null) {
        return null;
    }

    const startIndex = typeof locStart === "function" ? locStart(node) : Core.getNodeStartIndex(node);
    const endIndex = typeof locEnd === "function" ? locEnd(node) : Core.getNodeEndIndex(node);

    if (typeof startIndex !== NUMBER_TYPE || typeof endIndex !== NUMBER_TYPE) {
        return null;
    }

    if (endIndex <= startIndex) {
        return null;
    }

    return originalText.slice(startIndex, endIndex).trim();
}

function structLiteralHasLeadingLineBreak(node, options) {
    if (!node) {
        return false;
    }

    const originalText = getOriginalTextFromOptions(options);

    if (!Core.isNonEmptyArray(node.properties)) {
        return false;
    }

    const { start, end } = Core.getNodeRangeIndices(node);
    const source = sliceOriginalText(originalText, start, end);
    if (source === null) {
        return false;
    }
    const openBraceIndex = source.indexOf("{");
    if (openBraceIndex === -1) {
        return false;
    }

    for (let index = openBraceIndex + 1; index < source.length; index += 1) {
        const character = source[index];

        if (character === "\n") {
            return true;
        }

        if (character === "\r") {
            if (source[index + 1] === "\n") {
                return true;
            }
            return true;
        }

        if (character.trim() === "") {
            continue;
        }

        if (character === "/") {
            const lookahead = source[index + 1];

            if (lookahead === "/") {
                const result = consumeSingleLineComment(source, index + 2);
                if (result.foundLineBreak) {
                    return true;
                }
                index = result.index;
                continue;
            }

            if (lookahead === "*") {
                const result = consumeBlockComment(source, index + 2);
                if (result.foundLineBreak) {
                    return true;
                }
                index = result.index;
                continue;
            }
        }

        if (character === "}") {
            return false;
        }

        return false;
    }

    return false;
}

function consumeSingleLineComment(source, startIndex) {
    let current = startIndex;
    while (current < source.length) {
        const commentChar = source[current];
        if (commentChar === "\n") {
            return { index: current, foundLineBreak: true };
        }
        if (commentChar === "\r") {
            return { index: current + 1, foundLineBreak: true };
        }

        current += 1;
    }

    return { index: current, foundLineBreak: false };
}

function consumeBlockComment(source, startIndex) {
    let current = startIndex;
    while (current < source.length - 1) {
        const commentChar = source[current];
        if (commentChar === "\n") {
            return { index: current, foundLineBreak: true };
        }
        if (commentChar === "\r") {
            return { index: current + 1, foundLineBreak: true };
        }

        if (commentChar === "*" && source[current + 1] === "/") {
            return { index: current + 1, foundLineBreak: false };
        }

        current += 1;
    }

    return { index: current, foundLineBreak: false };
}

function buildIfStatementDoc(path, options, print, node) {
    const parts: any[] = [
        printSingleClauseStatement(path, options, print, "if", "test", "consequent", {
            printInBlock,
            printWithoutExtraParens,
            getSourceTextForNode
        })
    ];

    const elseDoc = buildIfAlternateDoc(path, options, print, node);
    if (elseDoc) {
        parts.push([" else ", elseDoc]);
    }

    return concat(parts);
}

function buildIfAlternateDoc(path, options, print, node) {
    if (!node || node.alternate === null) {
        return null;
    }

    const alternateNode = node.alternate;

    if (alternateNode.type === "IfStatement") {
        // Keep chained `else if` statements unwrapped. Printing the alternate
        // with braces would produce `else { if (...) ... }`, which breaks the
        // cascade that GameMaker expects, introduces an extra block for the
        // runtime to evaluate, and diverges from the control-structure style
        // documented in the GameMaker manual's Else If guidance.
        // By delegating directly to the child printer we preserve the
        // flattened `else if` ladder that authors wrote and that downstream
        // tools rely on when parsing the control flow.
        return print("alternate");
    }

    if (shouldPrintBlockAlternateAsElseIf(alternateNode)) {
        return path.call((alternatePath) => alternatePath.call(print, "body", 0), "alternate");
    }

    return printInBlock(path, options, print, "alternate");
}
