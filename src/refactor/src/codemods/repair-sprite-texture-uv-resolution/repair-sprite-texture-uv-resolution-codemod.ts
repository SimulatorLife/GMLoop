import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import type { RepairSpriteTextureUvResolutionResult } from "../../types.js";
import { applySourceTextEdits } from "../codemod-helpers.js";

type AstRecord = Record<string, unknown>;
type SourceEdit = Readonly<{ start: number; end: number; text: string }>;

function isAstRecord(value: unknown): value is AstRecord {
    return Core.isObjectLike(value);
}

function isFunctionNode(node: AstRecord): boolean {
    return (
        node.type === "FunctionDeclaration" ||
        node.type === "ConstructorDeclaration" ||
        node.type === "FunctionExpression" ||
        node.type === "ArrowFunctionExpression"
    );
}

function getNodeSource(sourceText: string, node: unknown): string | null {
    if (!isAstRecord(node)) {
        return null;
    }
    const start = Core.getNodeStartIndex(node);
    const end = Core.getNodeEndIndex(node);
    return typeof start === "number" && typeof end === "number" ? sourceText.slice(start, end) : null;
}

function getFunctionName(node: AstRecord): string | null {
    if (typeof node.id === "string") {
        return node.id.toLowerCase();
    }
    return Core.getIdentifierName(node.id)?.toLowerCase() ?? null;
}

function unwrapParenthesizedExpression(node: unknown): AstRecord | null {
    let current = isAstRecord(node) ? node : null;
    while (current?.type === "ParenthesizedExpression") {
        current = isAstRecord(current.expression) ? current.expression : null;
    }
    return current;
}

function isNamedCall(node: unknown, functionNames: ReadonlySet<string>): node is AstRecord {
    if (!isAstRecord(node) || node.type !== "CallExpression") {
        return false;
    }

    const object = node.object;
    if (!isAstRecord(object) || object.type !== "Identifier" || typeof object.name !== "string") {
        return false;
    }

    return functionNames.has(object.name.toLowerCase());
}

function findNamedCall(node: unknown, functionNames: ReadonlySet<string>): AstRecord | null {
    if (isNamedCall(node, functionNames)) {
        return node;
    }
    if (Array.isArray(node)) {
        for (const child of node) {
            const match = findNamedCall(child, functionNames);
            if (match !== null) {
                return match;
            }
        }
        return null;
    }
    if (!isAstRecord(node)) {
        return null;
    }

    for (const [key, child] of Object.entries(node)) {
        if (key === "parent") {
            continue;
        }
        const match = findNamedCall(child, functionNames);
        if (match !== null) {
            return match;
        }
    }
    return null;
}

function getCallArgumentSource(sourceText: string, node: AstRecord): string | null {
    if (!Array.isArray(node.arguments) || node.arguments.length !== 1) {
        return null;
    }
    return getNodeSource(sourceText, node.arguments[0]);
}

function getIfBranchSource(sourceText: string, node: AstRecord, test: string): string | null {
    const consequent = getNodeSource(sourceText, node.consequent);
    if (consequent === null) {
        return null;
    }
    return `if ${test} ${consequent}`;
}

function getElseSource(sourceText: string, node: AstRecord): string {
    const alternate = node.alternate;
    if (!isAstRecord(alternate)) {
        return "";
    }

    const alternateSource = getNodeSource(sourceText, alternate);
    if (alternateSource === null) {
        return "";
    }

    if (alternate.type === "IfStatement") {
        return ` else ${alternateSource}`;
    }
    return ` else ${alternateSource}`;
}

function guardExistingTextureResolutionTest(testSource: string, textureArgument: string): string {
    if (testSource.includes("is_undefined")) {
        return testSource;
    }

    return `(not is_undefined(${textureArgument}) and ${testSource})`;
}

function getExistingSpriteTextureGuardEdit(
    sourceText: string,
    firstBranch: AstRecord,
    secondBranch: AstRecord
): SourceEdit | null {
    const firstTestSource = getNodeSource(sourceText, firstBranch.test)?.trim();
    const secondTestSource = getNodeSource(sourceText, secondBranch.test)?.trim();
    if (firstTestSource === null || secondTestSource === null) {
        return null;
    }

    const spriteCall = findNamedCall(firstBranch.test, new Set(["scr_sprite_exists", "sprite_exists"]));
    const textureCall = findNamedCall(secondBranch.test, new Set(["scr_texture_is_valid"]));
    if (spriteCall === null || textureCall === null) {
        return null;
    }

    const spriteArgument = getCallArgumentSource(sourceText, spriteCall);
    const textureArgument = getCallArgumentSource(sourceText, textureCall);
    if (spriteArgument === null || textureArgument === null || spriteArgument !== textureArgument) {
        return null;
    }

    const firstConsequent = getNodeSource(sourceText, firstBranch.consequent);
    const secondConsequent = getNodeSource(sourceText, secondBranch.consequent);
    if (firstConsequent === null || secondConsequent === null) {
        return null;
    }

    const firstTest = guardExistingTextureResolutionTest(firstTestSource, textureArgument);
    const secondTest = guardExistingTextureResolutionTest(secondTestSource, textureArgument);
    if (firstTest === firstTestSource && secondTest === secondTestSource) {
        return null;
    }

    const start = Core.getNodeStartIndex(firstBranch);
    const end = Core.getNodeEndIndex(firstBranch);
    if (typeof start !== "number" || typeof end !== "number") {
        return null;
    }

    return Object.freeze({
        start,
        end,
        text: `if ${firstTest} ${firstConsequent} else if ${secondTest} ${secondConsequent}${getElseSource(sourceText, secondBranch)}`
    });
}

function getSpriteTextureBranchSwapEdit(sourceText: string, node: AstRecord): SourceEdit | null {
    if (node.type !== "IfStatement") {
        return null;
    }

    const firstBranch = node;
    const secondBranch =
        isAstRecord(firstBranch.alternate) && firstBranch.alternate.type === "IfStatement"
            ? firstBranch.alternate
            : null;
    if (secondBranch === null) {
        return null;
    }

    const firstCall = unwrapParenthesizedExpression(firstBranch.test);
    const secondCall = unwrapParenthesizedExpression(secondBranch.test);
    const textureFirst =
        isNamedCall(firstCall, new Set(["scr_texture_is_valid"])) &&
        isNamedCall(secondCall, new Set(["scr_sprite_exists", "sprite_exists"]));
    const spriteFirst =
        isNamedCall(firstCall, new Set(["scr_sprite_exists", "sprite_exists"])) &&
        isNamedCall(secondCall, new Set(["scr_texture_is_valid"]));
    if (!textureFirst && !spriteFirst) {
        return getExistingSpriteTextureGuardEdit(sourceText, firstBranch, secondBranch);
    }

    const textureBranch = textureFirst ? firstBranch : secondBranch;
    const spriteBranch = textureFirst ? secondBranch : firstBranch;
    const textureCall = textureFirst ? firstCall : secondCall;
    const spriteCall = textureFirst ? secondCall : firstCall;
    if (!isAstRecord(textureCall) || !isAstRecord(spriteCall)) {
        return null;
    }

    const textureArgument = getCallArgumentSource(sourceText, textureCall);
    const spriteArgument = getCallArgumentSource(sourceText, spriteCall);
    if (textureArgument === null || textureArgument !== spriteArgument) {
        return null;
    }

    const textureCallSource = getNodeSource(sourceText, textureCall);
    const spriteCallSource = getNodeSource(sourceText, spriteCall);
    if (textureCallSource === null || spriteCallSource === null) {
        return null;
    }

    const definedArgumentGuard = `not is_undefined(${textureArgument})`;
    const spriteTest = `(${definedArgumentGuard} and is_real(${textureArgument}) and ${textureArgument} >= 0 and ${spriteCallSource})`;
    const textureTest = `(${definedArgumentGuard} and is_ptr(${textureArgument}) and not is_real(${textureArgument}) and ${textureCallSource})`;
    const spriteSource = getIfBranchSource(sourceText, spriteBranch, spriteTest);
    const textureSource = getIfBranchSource(sourceText, textureBranch, textureTest);
    if (spriteSource === null || textureSource === null) {
        return null;
    }

    const start = Core.getNodeStartIndex(firstBranch);
    const end = Core.getNodeEndIndex(firstBranch);
    if (typeof start !== "number" || typeof end !== "number") {
        return null;
    }

    return Object.freeze({
        start,
        end,
        text: `${spriteSource} else ${textureSource}${getElseSource(sourceText, textureFirst ? spriteBranch : textureBranch)}`
    });
}

function collectSpriteTextureBranchSwapEdits(sourceText: string, programNode: unknown): ReadonlyArray<SourceEdit> {
    const edits: Array<SourceEdit> = [];

    const visit = (node: unknown, inTargetFunction: boolean): void => {
        if (Array.isArray(node)) {
            for (const child of node) {
                visit(child, inTargetFunction);
            }
            return;
        }
        if (!isAstRecord(node)) {
            return;
        }

        const targetFunction = isFunctionNode(node) && getFunctionName(node) === "scr_get_uvs";
        const shouldVisitChildren = inTargetFunction || targetFunction;
        if (shouldVisitChildren) {
            const edit = getSpriteTextureBranchSwapEdit(sourceText, node);
            if (edit !== null) {
                edits.push(edit);
            }
        }

        if (isFunctionNode(node) && !shouldVisitChildren) {
            return;
        }

        for (const [key, child] of Object.entries(node)) {
            if (key !== "parent") {
                visit(child, shouldVisitChildren);
            }
        }
    };

    visit(programNode, false);
    return edits;
}

/**
 * Resolve sprite UVs before texture-page UVs in a `scr_get_uvs` helper.
 *
 * HTML5 represents sprite asset references as numbers, while native GameMaker
 * keeps them distinct from numeric texture-page handles. Checking the texture
 * predicate first therefore misclassifies sprites in HTML5 and can make the
 * runtime dereference a sprite asset as a texture handle. The codemod swaps
 * only the structurally matching `scr_get_uvs` branches. Sprite lookup is
 * restricted to numeric handles and texture lookup is restricted to non-real pointers,
 * so `pointer_null` cannot reach either native helper. The explicit undefined
 * guard is required because HTML5 represents `pointer_null` as an undefined
 * value while native GameMaker represents it as a pointer sentinel. The
 * existing fallback branch and source text inside each branch are preserved.
 *
 * @param sourceText - GML source text to transform.
 * @returns The transformed source and applied source edits.
 */
export function applyRepairSpriteTextureUvResolutionCodemod(sourceText: string): RepairSpriteTextureUvResolutionResult {
    if (!sourceText.includes("scr_get_uvs") || !sourceText.includes("scr_texture_is_valid")) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    let programNode: unknown;
    try {
        programNode = Parser.GMLParser.parse(sourceText);
    } catch {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    const appliedEdits = collectSpriteTextureBranchSwapEdits(sourceText, programNode);
    if (appliedEdits.length === 0) {
        return Object.freeze({ changed: false, outputText: sourceText, appliedEdits: Object.freeze([]) });
    }

    const outputText = applySourceTextEdits(sourceText, appliedEdits);
    return Object.freeze({
        changed: outputText !== sourceText,
        outputText,
        appliedEdits: Object.freeze(appliedEdits)
    });
}
