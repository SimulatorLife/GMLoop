/**
 * Detects call expressions written without commas between arguments and flags them so downstream formatters preserve the raw text.
 */
import { Core, type MutableGameMakerAstNode } from "@gmloop/core";

type MarkCallsMissingArgumentSeparatorsTransformOptions = {
    originalText?: string;
};

function isNumericBoundaryCharacter(character: string | undefined) {
    // Numeric boundaries help identify when separators are truly missing rather than just whitespace.
    return /[0-9.-]/.test(character ?? "");
}

function shouldPreserveCallWithMissingSeparators(node: MutableGameMakerAstNode, originalText: string) {
    // Determine whether the spacing between arguments lacks commas and must be preserved.
    if (!node || node.type !== "CallExpression") {
        return false;
    }

    const args = Core.toMutableArray(node.arguments);

    if (
        args.some(
            (argument) =>
                argument && typeof argument === "object" && (argument as any).preserveOriginalCallText === true
        )
    ) {
        return true;
    }

    if (args.length < 2) {
        return false;
    }

    for (let index = 0; index < args.length - 1; index += 1) {
        const current = args[index];
        const next = args[index + 1];
        const currentEnd = Core.getNodeEndIndex(current);
        const nextStart = Core.getNodeStartIndex(next);

        if (currentEnd == null || nextStart == null || nextStart <= currentEnd) {
            continue;
        }

        const between = originalText.slice(currentEnd, nextStart);
        if (between.includes(",")) {
            continue;
        }

        const previousChar = currentEnd > 0 ? originalText[currentEnd - 1] : "";
        const nextChar = nextStart < originalText.length ? originalText[nextStart] : "";

        if (
            !Core.isNonEmptyTrimmedString(between) &&
            isNumericBoundaryCharacter(previousChar) &&
            isNumericBoundaryCharacter(nextChar)
        ) {
            return true;
        }
    }

    return false;
}

function markCallsMissingArgumentSeparators(ast: MutableGameMakerAstNode, originalText: string) {
    // Walk the AST and tag call expressions whose separator information can only be derived from the original source.
    if (Core.shouldSkipTraversal(ast)) {
        return;
    }

    const visitedNodes = new WeakSet();

    const visit = (node: MutableGameMakerAstNode) => {
        if (Core.shouldSkipTraversal(node, visitedNodes)) {
            return;
        }
        visitedNodes.add(node);

        Core.visitChildNodes(node, visit);

        if (shouldPreserveCallWithMissingSeparators(node, originalText)) {
            Object.defineProperty(node, "preserveOriginalCallText", {
                configurable: true,
                enumerable: false,
                writable: true,
                value: true
            });
        }
    };

    visit(ast);
}

function execute(
    ast: MutableGameMakerAstNode,
    options: MarkCallsMissingArgumentSeparatorsTransformOptions
): MutableGameMakerAstNode {
    // Only run when the original source is available so we can inspect the raw spacing between arguments.
    if (typeof options.originalText === "string") {
        markCallsMissingArgumentSeparators(ast, options.originalText);
    }
    return ast;
}

export const markCallsMissingArgumentSeparatorsTransform =
    Core.createParserTransform<MarkCallsMissingArgumentSeparatorsTransformOptions>(
        "mark-calls-missing-argument-separators",
        {},
        execute
    );
