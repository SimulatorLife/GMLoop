import { Core } from "@gmloop/core";
import type { Rule } from "eslint";

import { normalizeDocParamName } from "../../../parameter-utils/index.js";
import { gmlRuleDocCommentServices } from "../gml-rule-services.js";
import type { GmlRuleDefinition } from "../index.js";
import {
    type AstNodeWithType,
    computeLineStartOffsets,
    createMeta,
    getLineIndexForOffset,
    reportFullTextRewrite,
    walkAstNodesWithParent
} from "../rule-base-helpers.js";

const {
    convertLegacyReturnsDescriptionLinesToMetadata,
    promoteLeadingDocCommentTextToDescription,
    resolveParameterName
} = gmlRuleDocCommentServices;

const { applyJsDocTagAliasReplacements } = Core;

const { getNodeStartIndex } = Core;

function normalizeDocCommentPrefixLine(line: string): string {
    // support the "// /" notation used by some fixtures code
    // but avoid matching "// //" which is just a normal comment starting with two
    // slashes. we only want the single-slash variant.
    const docSlashMatch = /^(\s*)\/\/\s*\/(?!\/)(.*)$/u.exec(line);
    if (docSlashMatch) {
        const content = docSlashMatch[2].trim();
        if (/^[=+\-*/%<>!&|^]/u.test(content)) {
            return line;
        }
        if (content.length === 0) {
            return `${docSlashMatch[1]}///`;
        }
        return `${docSlashMatch[1]}/// ${content}`;
    }

    const tripleSlashMatch = /^(\s*)\/\/\/\s*@(.*)$/u.exec(line);
    if (tripleSlashMatch) {
        return `${tripleSlashMatch[1]}/// @${tripleSlashMatch[2].trim()}`;
    }

    const doubleSlashAtMatch = /^(\s*)\/\/\s*@(.*)$/u.exec(line);
    if (doubleSlashAtMatch) {
        return `${doubleSlashAtMatch[1]}/// @${doubleSlashAtMatch[2].trim()}`;
    }

    const tripleSlashNoAtMatch = /^(\s*)\/\/\/\s*(.*)$/u.exec(line);
    if (tripleSlashNoAtMatch) {
        const content = tripleSlashNoAtMatch[2].trim();
        if (content.length === 0) {
            return `${tripleSlashNoAtMatch[1]}///`;
        }
        return `${tripleSlashNoAtMatch[1]}/// ${content}`;
    }

    return line;
}

type FunctionLineCandidate = Readonly<{
    functionNode: AstNodeWithType;
    assignmentStyle: boolean;
    propertyStyle: boolean;
    staticStyle: boolean;
    sourceNode: AstNodeWithType;
}>;

function isFunctionInitializerNode(node: unknown): node is AstNodeWithType {
    if (!node || typeof node !== "object") {
        return false;
    }

    const nodeType = Reflect.get(node, "type");
    return (
        nodeType === "FunctionDeclaration" || nodeType === "FunctionExpression" || nodeType === "ConstructorDeclaration"
    );
}

function isStandaloneFunctionDeclarationContext(parent: AstNodeWithType | null, parentKey: string | null): boolean {
    if (!parent) {
        return false;
    }

    if (parent.type === "Program" && parentKey === "body") {
        return true;
    }

    if (parent.type === "BlockStatement" && parentKey === "body") {
        return true;
    }

    return false;
}

function getFunctionCandidateForNode(
    node: AstNodeWithType,
    parent: AstNodeWithType | null,
    parentKey: string | null
): FunctionLineCandidate | null {
    if (node.type === "FunctionDeclaration" || node.type === "ConstructorDeclaration") {
        if (!isStandaloneFunctionDeclarationContext(parent, parentKey)) {
            return null;
        }

        return {
            functionNode: node,
            assignmentStyle: false,
            propertyStyle: false,
            staticStyle: false,
            sourceNode: node
        };
    }

    if (node.type === "VariableDeclaration") {
        const declarations = Reflect.get(node, "declarations");
        if (!Array.isArray(declarations) || declarations.length !== 1) {
            return null;
        }

        const declarator = declarations[0] as { type?: string; init?: unknown } | undefined;
        if (!declarator || declarator.type !== "VariableDeclarator" || !isFunctionInitializerNode(declarator.init)) {
            return null;
        }

        return {
            functionNode: declarator.init,
            assignmentStyle: true,
            propertyStyle: false,
            staticStyle: Reflect.get(node, "kind") === "static",
            sourceNode: node
        };
    }

    if (node.type === "ExpressionStatement") {
        const expression = Reflect.get(node, "expression");
        if (!expression || typeof expression !== "object") {
            return null;
        }
        const expressionType = Reflect.get(expression, "type");
        if (expressionType !== "AssignmentExpression") {
            return null;
        }
        const right = Reflect.get(expression, "right");
        if (!isFunctionInitializerNode(right)) {
            return null;
        }

        return {
            functionNode: right,
            assignmentStyle: true,
            propertyStyle: false,
            staticStyle: false,
            sourceNode: node
        };
    }

    if (node.type === "AssignmentExpression") {
        const right = Reflect.get(node, "right");
        if (!isFunctionInitializerNode(right)) {
            return null;
        }

        return {
            functionNode: right,
            assignmentStyle: true,
            propertyStyle: false,
            staticStyle: false,
            sourceNode: node
        };
    }

    if (node.type === "Property" && parent?.type === "StructExpression" && parentKey === "properties") {
        const propertyValue = Reflect.get(node, "value");
        if (!isFunctionInitializerNode(propertyValue)) {
            return null;
        }

        return {
            functionNode: propertyValue,
            assignmentStyle: false,
            propertyStyle: true,
            staticStyle: false,
            sourceNode: node
        };
    }

    return null;
}

function collectFunctionNodesByStartLine(
    programNode: unknown,
    lineStartOffsets: ReadonlyArray<number>
): Map<number, Array<FunctionLineCandidate>> {
    const nodesByLine = new Map<number, Array<FunctionLineCandidate>>();
    walkAstNodesWithParent(programNode, ({ node, parent, parentKey }) => {
        const candidate = getFunctionCandidateForNode(node, parent, parentKey);
        if (!candidate) {
            return;
        }

        const start = getNodeStartIndex(node);
        if (typeof start !== "number") {
            return;
        }

        const lineIndex = getLineIndexForOffset(lineStartOffsets, start);
        const existing = nodesByLine.get(lineIndex) ?? [];
        existing.push(candidate);
        nodesByLine.set(lineIndex, existing);
    });

    return nodesByLine;
}

// Fallback parser used when the AST supplied to the rule is a stub (as in the
// unit test harness). It extracts param names and defaults from the textual
// function declaration. Not perfect, but sufficient for the lightweight tests.
function extractParamsFromLine(line: string): Array<{ name: string; defaultVal?: string }> {
    const match = line.match(/\(([^)]*)\)/);
    if (!match) {
        return [];
    }
    const list = match[1]
        .split(",")
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    return list.map((p) => {
        const parts = p.split("=").map((s) => s.trim());
        const name = normalizeDocParamName(parts[0]);
        let defaultVal: string | undefined;
        if (parts.length > 1) {
            defaultVal = parts.slice(1).join("=");
        }
        return { name, defaultVal };
    });
}

function countNamedFunctionParameters(functionNode: AstNodeWithType): number {
    const params = Reflect.get(functionNode, "params");
    if (!Array.isArray(params)) {
        return 0;
    }

    let count = 0;
    for (const param of params) {
        if (resolveParameterName(param) !== undefined) {
            count += 1;
        }
    }

    return count;
}

function extractDefaultParameterValueText(sourceText: string, parameterNode: AstNodeWithType): string | null {
    const parameterRange = Reflect.get(parameterNode, "range");
    if (Array.isArray(parameterRange) && parameterRange.length === 2) {
        const startOffset = parameterRange[0];
        const endOffset = parameterRange[1];
        if (typeof startOffset === "number" && typeof endOffset === "number" && endOffset > startOffset) {
            const parameterText = sourceText.slice(startOffset, endOffset);
            const separatorOffset = parameterText.indexOf("=");
            if (separatorOffset !== -1) {
                const defaultValueText = parameterText.slice(separatorOffset + 1).trim();
                if (defaultValueText.length > 0) {
                    return defaultValueText;
                }
            }
        }
    }

    const rightNode = Reflect.get(parameterNode, "right");
    if (!rightNode || typeof rightNode !== "object") {
        return null;
    }

    const rightRange = Reflect.get(rightNode, "range");
    if (!Array.isArray(rightRange) || rightRange.length !== 2) {
        return null;
    }

    const startOffset = rightRange[0];
    const endOffset = rightRange[1];
    if (typeof startOffset !== "number" || typeof endOffset !== "number" || endOffset <= startOffset) {
        return null;
    }

    const defaultValueText = sourceText.slice(startOffset, endOffset).trim();
    return defaultValueText.length > 0 ? defaultValueText : null;
}

function alignDescriptionContinuationLines(docLines: ReadonlyArray<string>): ReadonlyArray<string> {
    const aligned: Array<string> = [];
    let inDescription = false;
    let descriptionIndentation = "";

    for (const line of docLines) {
        const descMatch = /^(\s*)\/\/\/\s*@description\s+(.*)$/u.exec(line);
        if (descMatch) {
            inDescription = true;
            descriptionIndentation = `${descMatch[1]}/// `;
            aligned.push(line);
            continue;
        }

        if (inDescription && /^\s*\/\/\/\s*[^@\s]/u.test(line)) {
            const content = line.trimStart().slice(3).trimStart();
            aligned.push(`${descriptionIndentation}${content}`);
            continue;
        }

        if (/^\s*\/\/\/\s*@/u.test(line)) {
            inDescription = false;
        }

        aligned.push(line);
    }

    return aligned;
}

function isUndefinedDefaultValueText(defaultValueText: string): boolean {
    return defaultValueText.trim() === "undefined";
}

function formatOptionalParamDocName(parameterName: string, defaultValueText: string): string {
    if (isUndefinedDefaultValueText(defaultValueText)) {
        return `[${parameterName}]`;
    }

    return `[${parameterName}=${defaultValueText}]`;
}

function normalizeUndefinedOptionalDefaultParamDocLine(line: string): string {
    const normalized = /^(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s+)\[([A-Za-z0-9_]+)\s*=\s*undefined\](.*)$/u.exec(line);
    if (!normalized) {
        return line;
    }

    return `${normalized[1]}[${normalized[2]}]${normalized[3]}`;
}

function normalizeParamDescriptionSeparatorHyphen(line: string): string {
    const normalized = /^(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s+(?:\[[^\]]+\]|[A-Za-z0-9_]+))\s+-\s+(.+)$/u.exec(line);
    if (!normalized) {
        return line;
    }

    return `${normalized[1]} ${normalized[2]}`;
}

function normalizeParamDescriptionSpacing(line: string): string {
    const normalized = /^(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s+(?:\[[^\]]+\]|[A-Za-z0-9_]+))\s{2,}(\S.*)$/u.exec(line);
    if (!normalized) {
        return line;
    }

    return `${normalized[1]} ${normalized[2]}`;
}

type DocCommentParamMetadata = Readonly<{
    name: string;
    typeText: string | null;
}>;

function rewriteDocCommentParamLineName(line: string, replacementName: string): string {
    const optionalMatch = /^(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s+)\[([A-Za-z0-9_]+)([^\]]*)\](.*)$/u.exec(line);
    if (optionalMatch) {
        return `${optionalMatch[1]}${replacementName}${optionalMatch[4]}`;
    }

    const requiredMatch = /^(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s+)([A-Za-z0-9_]+)(.*)$/u.exec(line);
    if (requiredMatch) {
        return `${requiredMatch[1]}${replacementName}${requiredMatch[3]}`;
    }

    return line;
}

function remapUnmatchedParamDocLinesToFunctionOrder(
    docLines: ReadonlyArray<string>,
    functionParameterNamesInOrder: ReadonlyArray<string>
): ReadonlyArray<string> {
    if (functionParameterNamesInOrder.length === 0) {
        return docLines;
    }

    const functionParameterNameSet = new Set(functionParameterNamesInOrder);
    const matchedFunctionParamNames = new Set<string>();
    const unmatchedParamLineIndices: Array<number> = [];

    for (const [index, line] of docLines.entries()) {
        const metadata = parseDocCommentParamMetadata(line);
        if (!metadata) {
            continue;
        }

        const normalizedDocParamName = normalizeDocParamName(metadata.name);
        if (
            functionParameterNameSet.has(normalizedDocParamName) &&
            !matchedFunctionParamNames.has(normalizedDocParamName)
        ) {
            matchedFunctionParamNames.add(normalizedDocParamName);
            continue;
        }

        unmatchedParamLineIndices.push(index);
    }

    if (unmatchedParamLineIndices.length === 0) {
        return docLines;
    }

    const missingFunctionParamNames = functionParameterNamesInOrder.filter(
        (parameterName) => !matchedFunctionParamNames.has(parameterName)
    );
    if (missingFunctionParamNames.length === 0) {
        return docLines;
    }

    const rewrittenLines = [...docLines];
    const pairCount = Math.min(unmatchedParamLineIndices.length, missingFunctionParamNames.length);
    for (let i = 0; i < pairCount; i++) {
        rewrittenLines[unmatchedParamLineIndices[i]] = rewriteDocCommentParamLineName(
            rewrittenLines[unmatchedParamLineIndices[i]],
            missingFunctionParamNames[i]
        );
    }

    return rewrittenLines;
}

function parseDocCommentParamMetadata(line: string): DocCommentParamMetadata | null {
    const paramMatch = /^\s*\/\/\/\s*@param(?:\s+\{([^}]+)\})?\s+\[?([A-Za-z0-9_]+)(?:=[^\]]*)?\]?/u.exec(line);
    if (!paramMatch) {
        return null;
    }

    const rawTypeText = typeof paramMatch[1] === "string" ? paramMatch[1].trim() : "";
    return {
        name: paramMatch[2],
        typeText: rawTypeText.length > 0 ? rawTypeText : null
    };
}

function normalizeDocParamLineParameterName(line: string): string {
    const optionalMatch = /^(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s+)\[([A-Za-z0-9_]+)([^\]]*)\](.*)$/u.exec(line);
    if (optionalMatch) {
        return `${optionalMatch[1]}[${normalizeDocParamName(optionalMatch[2])}${optionalMatch[3]}]${optionalMatch[4]}`;
    }

    const requiredMatch = /^(\s*\/\/\/\s*@param(?:\s+\{[^}]+\})?\s+)([A-Za-z0-9_]+)(.*)$/u.exec(line);
    if (requiredMatch) {
        return `${requiredMatch[1]}${normalizeDocParamName(requiredMatch[2])}${requiredMatch[3]}`;
    }

    return line;
}

function collectDocCommentParamTypesByName(docLines: ReadonlyArray<string>): Map<string, string> {
    const typesByName = new Map<string, string>();
    for (const line of docLines) {
        const metadata = parseDocCommentParamMetadata(line);
        if (!metadata || metadata.typeText === null) {
            continue;
        }

        const cleanName = normalizeDocParamName(metadata.name);
        if (!typesByName.has(cleanName)) {
            typesByName.set(cleanName, metadata.typeText);
        }
    }

    return typesByName;
}

function removeParamDocLinesNotInFunctionSignature(
    docLines: ReadonlyArray<string>,
    functionParameterNames: ReadonlySet<string>
): ReadonlyArray<string> {
    return docLines.filter((line) => {
        const metadata = parseDocCommentParamMetadata(line);
        if (!metadata) {
            return true;
        }

        return functionParameterNames.has(normalizeDocParamName(metadata.name));
    });
}

function reorderDocParamLinesByFunctionOrder(
    docLines: ReadonlyArray<string>,
    functionParameterNamesInOrder: ReadonlyArray<string>
): ReadonlyArray<string> {
    const parameterOrder = new Map<string, number>();
    for (const [index, name] of functionParameterNamesInOrder.entries()) {
        if (!parameterOrder.has(name)) {
            parameterOrder.set(name, index);
        }
    }

    const paramEntries = docLines
        .map((line, index) => {
            const metadata = parseDocCommentParamMetadata(line);
            if (!metadata) {
                return null;
            }
            return {
                index,
                line,
                name: normalizeDocParamName(metadata.name)
            };
        })
        .filter((entry): entry is { index: number; line: string; name: string } => entry !== null);

    if (paramEntries.length <= 1) {
        return docLines;
    }

    const sortedEntries = Array.from(paramEntries).toSorted((left, right) => {
        const leftOrder = parameterOrder.get(left.name);
        const rightOrder = parameterOrder.get(right.name);
        const leftKey = leftOrder ?? Number.MAX_SAFE_INTEGER;
        const rightKey = rightOrder ?? Number.MAX_SAFE_INTEGER;
        if (leftKey !== rightKey) {
            return leftKey - rightKey;
        }
        return left.index - right.index;
    });

    const rewritten = Array.from(docLines);
    for (const [orderIndex, originalEntry] of paramEntries.entries()) {
        rewritten[originalEntry.index] = sortedEntries[orderIndex].line;
    }
    return rewritten;
}

type ReturnInferenceSummary = Readonly<{
    hasReturnStatement: boolean;
    hasConcreteReturn: boolean;
    hasUndefinedReturn: boolean;
    hasStructReturnWithFunctionProperties: boolean;
    concreteReturnType: string | null;
}>;

function isFunctionLikeNodeType(nodeType: string): boolean {
    return (
        nodeType === "FunctionDeclaration" ||
        nodeType === "FunctionExpression" ||
        nodeType === "ConstructorDeclaration" ||
        nodeType === "StructFunctionDeclaration"
    );
}

function hasInstanceFunctionAssignment(functionNode: AstNodeWithType): boolean {
    const bodyNode = Reflect.get(functionNode, "body");
    const stack: unknown[] = [];
    if (bodyNode && typeof bodyNode === "object") {
        stack.push(bodyNode);
    }

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== "object") {
            continue;
        }

        if (Array.isArray(current)) {
            for (const child of current) {
                stack.push(child);
            }
            continue;
        }

        const currentType = Reflect.get(current, "type");
        if (currentType === "AssignmentExpression" && isFunctionInitializerNode(Reflect.get(current, "right"))) {
            return true;
        }

        if (typeof currentType === "string" && isFunctionLikeNodeType(currentType)) {
            continue;
        }

        for (const [key, value] of Object.entries(current)) {
            if (key === "parent") {
                continue;
            }

            if (value && typeof value === "object") {
                stack.push(value);
            }
        }
    }

    return false;
}

function shouldSuppressSyntheticReturnsForFunctionNode(functionNode: AstNodeWithType): boolean {
    if (functionNode.type === "StructFunctionDeclaration") {
        return true;
    }

    if (functionNode.type !== "ConstructorDeclaration") {
        return false;
    }

    return !hasInstanceFunctionAssignment(functionNode);
}

function isUndefinedReturnArgument(argument: unknown): boolean {
    if (!argument || typeof argument !== "object") {
        return false;
    }

    const argumentType = Reflect.get(argument, "type");
    if (argumentType === "Identifier" && Reflect.get(argument, "name") === "undefined") {
        return true;
    }

    if (argumentType !== "Literal") {
        return false;
    }

    const value = Reflect.get(argument, "value");
    return value === undefined || value === "undefined";
}

function isNumericLiteralText(value: string): boolean {
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.trim());
}

function getIdentifierNodeName(node: unknown): string | null {
    if (!node || typeof node !== "object" || Reflect.get(node, "type") !== "Identifier") {
        return null;
    }

    const name = Reflect.get(node, "name");
    return typeof name === "string" && name.length > 0 ? name : null;
}

function getNormalizedIdentifierNodeName(node: unknown): string | null {
    const name = getIdentifierNodeName(node);
    return name === null ? null : normalizeDocParamName(name);
}

function isStructValuedExpression(expression: unknown): boolean {
    return Boolean(
        expression && typeof expression === "object" && Reflect.get(expression, "type") === "StructExpression"
    );
}

function hasFunctionValuedStructProperty(expression: unknown): boolean {
    if (!expression || typeof expression !== "object" || !isStructValuedExpression(expression)) {
        return false;
    }

    const stack: unknown[] = [expression];
    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== "object") {
            continue;
        }

        if (current !== expression) {
            const currentType = Reflect.get(current, "type");
            if (typeof currentType === "string" && isFunctionLikeNodeType(currentType)) {
                return true;
            }
        }

        for (const [key, value] of Object.entries(current)) {
            if (key === "parent") {
                continue;
            }

            if (Array.isArray(value)) {
                for (const child of value) {
                    stack.push(child);
                }
                continue;
            }

            if (value && typeof value === "object") {
                stack.push(value);
            }
        }
    }

    return false;
}

function recordStructValuedIdentifierFromDeclarator(node: object, structValuedIdentifiers: Set<string>): void {
    if (Reflect.get(node, "type") !== "VariableDeclarator") {
        return;
    }

    if (!isStructValuedExpression(Reflect.get(node, "init"))) {
        return;
    }

    const identifierName = getNormalizedIdentifierNodeName(Reflect.get(node, "id"));
    if (identifierName !== null) {
        structValuedIdentifiers.add(identifierName);
    }
}

function recordStructValuedIdentifierFromAssignment(node: object, structValuedIdentifiers: Set<string>): void {
    if (Reflect.get(node, "type") !== "AssignmentExpression") {
        return;
    }

    if (Reflect.get(node, "operator") !== "=" || !isStructValuedExpression(Reflect.get(node, "right"))) {
        return;
    }

    const identifierName = getNormalizedIdentifierNodeName(Reflect.get(node, "left"));
    if (identifierName !== null) {
        structValuedIdentifiers.add(identifierName);
    }
}

function inferConcreteReturnTypeFromArgument(
    argument: unknown,
    functionParameterNames: ReadonlySet<string>,
    docParamTypesByName: ReadonlyMap<string, string>,
    structValuedIdentifiers: ReadonlySet<string>
): string {
    if (!argument || typeof argument !== "object") {
        return "any";
    }

    const argumentType = Reflect.get(argument, "type");
    if (argumentType === "StructExpression") {
        return "Struct";
    }

    if (argumentType === "Literal") {
        const literalValue = Reflect.get(argument, "value");
        if (typeof literalValue === "number") {
            return "real";
        }

        if (typeof literalValue === "string" && isNumericLiteralText(literalValue)) {
            return "real";
        }

        return "any";
    }

    if (argumentType === "Identifier") {
        const identifierName = Reflect.get(argument, "name");
        if (typeof identifierName !== "string" || identifierName.length === 0) {
            return "any";
        }

        const cleanName = normalizeDocParamName(identifierName);
        if (structValuedIdentifiers.has(cleanName)) {
            return "Struct";
        }

        if (!functionParameterNames.has(cleanName)) {
            return "any";
        }

        return docParamTypesByName.get(cleanName) ?? "any";
    }

    return "any";
}

function mergeConcreteReturnType(current: string | null, next: string): string {
    if (current === null) {
        return next;
    }

    if (current === next) {
        return current;
    }

    return "any";
}

function analyzeFunctionReturnInference(
    functionNode: AstNodeWithType,
    functionParameterNames: ReadonlySet<string>,
    docParamTypesByName: ReadonlyMap<string, string>
): ReturnInferenceSummary {
    let hasReturnStatement = false;
    let hasConcreteReturn = false;
    let hasUndefinedReturn = false;
    let hasStructReturnWithFunctionProperties = false;
    let concreteReturnType: string | null = null;
    const structValuedIdentifiers = new Set<string>();

    const bodyNode = Reflect.get(functionNode, "body");
    const stack: unknown[] = [];
    if (bodyNode && typeof bodyNode === "object") {
        stack.push(bodyNode);
    }

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current || typeof current !== "object") {
            continue;
        }

        if (Array.isArray(current)) {
            for (let index = current.length - 1; index >= 0; index -= 1) {
                stack.push(current[index]);
            }
            continue;
        }

        const currentType = Reflect.get(current, "type");
        recordStructValuedIdentifierFromDeclarator(current, structValuedIdentifiers);
        recordStructValuedIdentifierFromAssignment(current, structValuedIdentifiers);

        if (currentType === "ReturnStatement") {
            hasReturnStatement = true;
            const argument = Reflect.get(current, "argument");
            if (argument == null || isUndefinedReturnArgument(argument)) {
                hasUndefinedReturn = true;
                continue;
            }

            hasConcreteReturn = true;
            if (hasFunctionValuedStructProperty(argument)) {
                hasStructReturnWithFunctionProperties = true;
            }
            const inferredType = inferConcreteReturnTypeFromArgument(
                argument,
                functionParameterNames,
                docParamTypesByName,
                structValuedIdentifiers
            );
            concreteReturnType = mergeConcreteReturnType(concreteReturnType, inferredType);
            continue;
        }

        if (typeof currentType === "string" && isFunctionLikeNodeType(currentType)) {
            continue;
        }

        for (const [key, value] of Object.entries(current)) {
            if (key === "parent") {
                continue;
            }

            if (value && typeof value === "object") {
                stack.push(value);
            }
        }
    }

    return {
        hasReturnStatement,
        hasConcreteReturn,
        hasUndefinedReturn,
        hasStructReturnWithFunctionProperties,
        concreteReturnType
    };
}

function inferReturnDocTypeFromFunctionNode(
    functionNode: AstNodeWithType,
    functionParameterNames: ReadonlySet<string>,
    docParamTypesByName: ReadonlyMap<string, string>
): ReturnInferenceSummary {
    return analyzeFunctionReturnInference(functionNode, functionParameterNames, docParamTypesByName);
}

function normalizeReturnTypeForComparison(typeText: string | null): string {
    if (typeof typeText !== "string") {
        return "";
    }

    return typeText.replaceAll(/\s+/gu, "").toLowerCase();
}

function parseReturnDocType(line: string): string | null {
    const match = /^\s*\/\/\/\s*@returns?\s+\{([^}]+)\}/u.exec(line);
    if (!match) {
        return null;
    }

    const typeText = match[1].trim();
    return typeText.length > 0 ? typeText : null;
}

function isEmptyReturnDocLine(line: string): boolean {
    return /^\s*\/\/\/\s*@returns?\s*$/u.test(line);
}

function normalizeReturnDocLineType(line: string): string {
    return line.replace(
        /^(\s*\/\/\/\s*@returns?\s+\{)([^}]+)(\}.*)$/u,
        (_match, prefix: string, typeText: string, suffix: string) => {
            const normalizedTypeText = normalizeReturnTypeForComparison(typeText) === "void" ? "undefined" : typeText;
            return `${prefix}${normalizedTypeText}${suffix}`;
        }
    );
}

function dedupeReturnDocLines(docLines: ReadonlyArray<string>): ReadonlyArray<string> {
    let hasReturnLine = false;
    const dedupedLines: Array<string> = [];
    for (const line of docLines) {
        if (!/^\s*\/\/\/\s*@returns?\b/u.test(line)) {
            dedupedLines.push(line);
            continue;
        }

        if (hasReturnLine) {
            continue;
        }

        hasReturnLine = true;
        dedupedLines.push(line);
    }

    return dedupedLines;
}

function removeReturnDocLines(docLines: Array<string>): void {
    for (let index = docLines.length - 1; index >= 0; index -= 1) {
        if (/^\s*\/\/\/\s*@returns?/u.test(docLines[index])) {
            docLines.splice(index, 1);
        }
    }
}

function isFunctionDefaultValueText(defaultValueText: string): boolean {
    return /^\s*function\b/u.test(defaultValueText);
}

function getFunctionNodeName(functionNode: AstNodeWithType): string {
    const id = Reflect.get(functionNode, "id");
    if (typeof id === "string") {
        return id;
    }

    const identifierName = getIdentifierNodeName(id);
    return identifierName ?? "";
}

// Generate a canonical doc-comment block for a function. This helper is
// intentionally broad: it can operate on an existing (possibly-empty) list of
// normalized lines and will fold in any missing @param/@returns tags while
// preserving the original ordering, indentation, and any user-provided
// descriptions. Existing placeholder descriptions that exactly match the
// function name are pruned before we generate anything else, since they are
// purely noise in the fixtures.
function synthesizeFunctionDocCommentBlock(
    existingLines: ReadonlyArray<string> | null,
    sourceText: string,
    functionNode: AstNodeWithType | null,
    allowSynthesisWithoutDocs: boolean,
    assignmentStyle: boolean,
    propertyStyle: boolean,
    staticStyle: boolean,
    hasLeadingIndentation: boolean
): ReadonlyArray<string> | null {
    if (!functionNode) {
        return null;
    }

    const name = getFunctionNodeName(functionNode);
    // start with a mutable copy of whatever the user already wrote
    const block = existingLines ? Array.from(existingLines) : [];
    const hadInputDocLines = block.length > 0;
    if (block.length === 0 && !allowSynthesisWithoutDocs) {
        return null;
    }

    // remove any literal placeholder description that simply repeats the name
    for (let i = block.length - 1; i >= 0; i--) {
        if (
            name.length > 0 &&
            new RegExp(String.raw`^\s*///\s*@description\s+${Core.escapeRegExp(name)}\s*$`).test(block[i])
        ) {
            block.splice(i, 1);
        }
    }

    const indentation = /^((?:\s*)?)\S?/.exec(block[0] || "")?.[1] || "";

    const { inOrder: functionParameterNamesInOrder, set: functionParameterNames } =
        getFunctionParameterNames(functionNode);
    const remappedBlock = remapUnmatchedParamDocLinesToFunctionOrder(block, functionParameterNamesInOrder);
    const prunedBlock = removeParamDocLinesNotInFunctionSignature(remappedBlock, functionParameterNames);
    const reorderedBlock = reorderDocParamLinesByFunctionOrder(prunedBlock, functionParameterNamesInOrder);
    block.splice(0, block.length, ...reorderedBlock);

    // examine what we currently have, so we only add missing lines
    const existingParams = new Set<string>();
    const existingParamTypesByName = collectDocCommentParamTypesByName(block);
    const existingReturnLines = block.filter((line) => /^\s*\/\/\/\s*@returns?/u.test(line));
    let hasReturns = existingReturnLines.length > 0;
    const suppressSyntheticReturns = shouldSuppressSyntheticReturnsForFunctionNode(functionNode);
    if (suppressSyntheticReturns && hasReturns) {
        removeReturnDocLines(block);
        hasReturns = false;
    }
    for (const line of block) {
        const metadata = parseDocCommentParamMetadata(line);
        if (metadata) {
            existingParams.add(normalizeDocParamName(metadata.name));
        }
    }

    const params = (functionNode as any).params || [];
    for (const param of params) {
        const paramName = resolveParameterName(param);
        let defaultVal: string | undefined;

        if (param.type === "DefaultParameter" || param.type === "AssignmentPattern") {
            const extractedDefault = extractDefaultParameterValueText(sourceText, param);
            if (extractedDefault !== null) {
                defaultVal = extractedDefault;
            }
        }

        if (!paramName) continue;
        const cleanName = normalizeDocParamName(paramName);
        if (existingParams.has(cleanName)) {
            if (defaultVal === undefined) {
                updateExistingParamDocWithoutDefault(block, cleanName);
            } else {
                updateExistingParamDocWithDefault(block, cleanName, defaultVal);
            }
            continue;
        }

        if (defaultVal === undefined) {
            block.push(`${indentation}/// @param ${cleanName}`);
        } else if (isFunctionDefaultValueText(defaultVal)) {
            block.push(`${indentation}/// @param {function} [${cleanName}]`);
        } else {
            block.push(`${indentation}/// @param ${formatOptionalParamDocName(cleanName, defaultVal)}`);
        }
    }

    const returnInference = inferReturnDocTypeFromFunctionNode(
        functionNode,
        functionParameterNames,
        existingParamTypesByName
    );
    const concreteReturnType = returnInference.concreteReturnType ?? "any";
    const inferredReturnType = returnInference.hasConcreteReturn
        ? returnInference.hasUndefinedReturn
            ? `${concreteReturnType}|undefined`
            : concreteReturnType
        : "undefined";

    const shouldSynthesizeReturnLine = determineIfShouldSynthesizeReturnLine({
        assignmentStyle,
        propertyStyle,
        staticStyle,
        hadInputDocLines,
        hasLeadingIndentation,
        functionParameterNamesInOrder,
        returnInference,
        inferredReturnType,
        hasExistingReturnLine: hasReturns,
        suppressSyntheticReturns
    });

    if (hasReturns && shouldSynthesizeReturnLine) {
        const firstExistingReturnType = parseReturnDocType(existingReturnLines[0] ?? "");
        const normalizedExistingReturnType = normalizeReturnTypeForComparison(firstExistingReturnType);
        const normalizedInferredReturnType = normalizeReturnTypeForComparison(inferredReturnType);
        const shouldReplaceWithInferredUndefined =
            normalizedExistingReturnType.length > 0 &&
            normalizedInferredReturnType === "undefined" &&
            normalizedExistingReturnType !== "undefined" &&
            normalizedExistingReturnType !== "void";
        const shouldReplaceUndefinedPlaceholder =
            normalizedExistingReturnType === "undefined" && normalizedInferredReturnType !== "undefined";
        const shouldReplaceUnstructuredReturn = normalizedExistingReturnType.length === 0;
        const hasEmptyExistingReturnLine = existingReturnLines.some((line) => isEmptyReturnDocLine(line));

        if (
            shouldReplaceWithInferredUndefined ||
            shouldReplaceUndefinedPlaceholder ||
            (shouldReplaceUnstructuredReturn && hasEmptyExistingReturnLine)
        ) {
            removeReturnDocLines(block);
            block.push(`${indentation}/// @returns {${inferredReturnType}}`);
            hasReturns = true;
        }
    }

    if (!hasReturns && shouldSynthesizeReturnLine) {
        block.push(`${indentation}/// @returns {${inferredReturnType}}`);
    }

    const alignedBlock = alignDescriptionContinuationLines(block);
    return Array.from(reorderFunctionDocLinesForCanonicalTagLayout(alignedBlock));
}

function processDocBlock(blockLines: Array<string>): Array<string> {
    if (blockLines.length === 0) {
        return [];
    }

    const emptyDescriptionPattern = /^(\s*)\/\/\/\s*@description\s*$/u;
    const hasOverrideTag = blockLines
        .map((line) => normalizeDocCommentPrefixLine(line))
        .map((line) => applyJsDocTagAliasLine(line))
        .some((line) => /^\s*\/\/\/\s*@override\b/u.test(line));
    const normalizedBlock = blockLines
        .filter((line) => !emptyDescriptionPattern.test(line))
        .map((line) => normalizeDocCommentPrefixLine(line))
        // canonicalize any alias tags such as @arg/@argument/@params/@desc, and
        // remove legacy @function markers entirely. this ensures downstream
        // logic can assume only the canonical forms remain.
        .map((line) => applyJsDocTagAliasLine(line))
        .map((line) => (hasOverrideTag ? line : normalizeReturnDocLineType(line)))
        .map((line) => normalizeDocParamLineParameterName(line))
        .map((line) => normalizeUndefinedOptionalDefaultParamDocLine(line))
        .map((line) => normalizeParamDescriptionSeparatorHyphen(line))
        .map((line) => normalizeParamDescriptionSpacing(line))
        .filter((line) => !emptyDescriptionPattern.test(line))
        .filter((line) => line.trimStart() !== "///")
        .filter((line): line is string => !/^\s*\/\/\/\s*@function\b/.test(line));

    const promotedBlock = promoteLeadingDocCommentTextToDescription(normalizedBlock, [], true);

    const returnsNormalizedBlock = convertLegacyReturnsDescriptionLinesToMetadata(promotedBlock);

    const dedupedReturnsBlock = dedupeReturnDocLines(returnsNormalizedBlock);

    return Array.from(alignDescriptionContinuationLines(dedupedReturnsBlock));
}

function isParamDocCommentLine(line: string): boolean {
    return /^\s*\/\/\/\s*@param\b/u.test(line);
}

function reorderFunctionDocLinesForCanonicalTagLayout(docLines: ReadonlyArray<string>): ReadonlyArray<string> {
    const nonReturnLines: Array<string> = [];
    const returnLines: Array<string> = [];

    for (const line of docLines) {
        if (/^\s*\/\/\/\s*@returns?\b/u.test(line)) {
            returnLines.push(line);
            continue;
        }

        nonReturnLines.push(line);
    }

    const firstParamIndex = nonReturnLines.findIndex((line) => isParamDocCommentLine(line));
    if (firstParamIndex === -1) {
        return [...nonReturnLines, ...returnLines];
    }

    let lastParamIndex = firstParamIndex;
    for (let index = nonReturnLines.length - 1; index >= firstParamIndex; index -= 1) {
        if (isParamDocCommentLine(nonReturnLines[index])) {
            lastParamIndex = index;
            break;
        }
    }

    const leadingNonParamLines: Array<string> = [];
    const trailingNonParamLines: Array<string> = [];
    const paramRegionLines: Array<string> = [];

    for (const [index, line] of nonReturnLines.entries()) {
        if (isParamDocCommentLine(line)) {
            paramRegionLines.push(line);
            continue;
        }

        const isInterleavedBetweenParamLines = index > firstParamIndex && index < lastParamIndex;
        if (isInterleavedBetweenParamLines) {
            paramRegionLines.push(line);
            continue;
        }

        if (index < firstParamIndex) {
            leadingNonParamLines.push(line);
            continue;
        }

        trailingNonParamLines.push(line);
    }

    return [...leadingNonParamLines, ...trailingNonParamLines, ...paramRegionLines, ...returnLines];
}

function dropFloatingParamDocCommentLines(docLines: ReadonlyArray<string>): ReadonlyArray<string> {
    if (!docLines.some((line) => isParamDocCommentLine(line))) {
        return docLines;
    }

    return docLines.filter((line) => !isParamDocCommentLine(line)).filter((line) => line.trimStart() !== "///");
}

function shouldSeparateTopLevelSynthesizedDocBlock(
    rewrittenLines: ReadonlyArray<string>,
    synthesizedDocBlock: ReadonlyArray<string>,
    hasLeadingIndentation: boolean
): boolean {
    if (hasLeadingIndentation || synthesizedDocBlock.length === 0 || rewrittenLines.length === 0) {
        return false;
    }

    const previousLine = rewrittenLines.at(-1);
    return typeof previousLine === "string" && previousLine.trim() === "};";
}

function flushDetachedDocCommentBlock(
    rewrittenLines: Array<string>,
    pendingDocBlock: ReadonlyArray<string>,
    pendingGapLines: ReadonlyArray<string>,
    dropFloatingParamLines: boolean
): void {
    if (pendingDocBlock.length === 0) {
        return;
    }

    const processedDetachedDocBlock = processDocBlock(Array.from(pendingDocBlock));
    const normalizedDetachedDocBlock = dropFloatingParamLines
        ? dropFloatingParamDocCommentLines(processedDetachedDocBlock)
        : processedDetachedDocBlock;
    if (normalizedDetachedDocBlock.length === 0) {
        return;
    }

    rewrittenLines.push(...normalizedDetachedDocBlock, ...pendingGapLines);
}

function applyJsDocTagAliasLine(line: string): string {
    const aliasReplaced = applyJsDocTagAliasReplacements(line);
    return typeof aliasReplaced === "string" ? aliasReplaced : line;
}

type FallbackParameterEntry = Readonly<{ name: string; defaultVal?: string }>;

function collectExistingParamNames(docLines: ReadonlyArray<string>): Set<string> {
    const existingParams = new Set<string>();
    for (const line of docLines) {
        const metadata = parseDocCommentParamMetadata(line);
        if (metadata) {
            existingParams.add(normalizeDocParamName(metadata.name));
        }
    }
    return existingParams;
}

function updateExistingParamDocWithDefault(docBlock: Array<string>, parameterName: string, defaultVal: string): void {
    const escapedParameterName = Core.escapeRegExp(parameterName);
    const normalizedDocName = isFunctionDefaultValueText(defaultVal)
        ? `[${parameterName}]`
        : formatOptionalParamDocName(parameterName, defaultVal);
    for (const [index, line] of docBlock.entries()) {
        const optionalParamMatch = new RegExp(
            String.raw`^(\s*///\s*@param)(\s+\{[^}]+\})?(\s+)\[${escapedParameterName}(?:=[^\]]*)?\]*(.*)$`
        ).exec(line);
        if (optionalParamMatch) {
            const typeAnnotation =
                optionalParamMatch[2] ?? (isFunctionDefaultValueText(defaultVal) ? " {function}" : "");
            docBlock[index] =
                `${optionalParamMatch[1]}${typeAnnotation}${optionalParamMatch[3]}${normalizedDocName}${optionalParamMatch[4]}`;
            return;
        }

        const requiredParamMatch = new RegExp(
            String.raw`^(\s*///\s*@param)(\s+\{[^}]+\})?(\s+)${escapedParameterName}\b(.*)$`
        ).exec(line);
        if (requiredParamMatch) {
            const typeAnnotation =
                requiredParamMatch[2] ?? (isFunctionDefaultValueText(defaultVal) ? " {function}" : "");
            docBlock[index] =
                `${requiredParamMatch[1]}${typeAnnotation}${requiredParamMatch[3]}${normalizedDocName}${requiredParamMatch[4]}`;
            return;
        }
    }
}

function updateExistingParamDocWithoutDefault(docBlock: Array<string>, parameterName: string): void {
    const escapedParameterName = Core.escapeRegExp(parameterName);
    for (const [index, line] of docBlock.entries()) {
        const optionalParamMatch = new RegExp(
            String.raw`^(\s*///\s*@param)(\s+\{[^}]+\})?(\s+)\[${escapedParameterName}(?:=[^\]]*)?\](.*)$`
        ).exec(line);
        if (optionalParamMatch) {
            docBlock[index] =
                `${optionalParamMatch[1]}${optionalParamMatch[2] ?? ""}${optionalParamMatch[3]}${parameterName}${optionalParamMatch[4]}`;
            return;
        }
    }
}

function updateExistingFallbackParamWithDefault(
    fallbackBlock: Array<string>,
    parameterName: string,
    defaultVal: string
): void {
    updateExistingParamDocWithDefault(fallbackBlock, parameterName, defaultVal);
}

function appendMissingFallbackParamLine(
    fallbackBlock: Array<string>,
    indentation: string,
    parameterName: string,
    defaultVal: string | undefined
): void {
    if (defaultVal === undefined) {
        fallbackBlock.push(`${indentation}/// @param ${parameterName}`);
        return;
    }

    fallbackBlock.push(`${indentation}/// @param ${formatOptionalParamDocName(parameterName, defaultVal)}`);
}

function mergeFallbackParamLines(
    fallbackBlock: Array<string>,
    fallbackParams: ReadonlyArray<FallbackParameterEntry>,
    indentation: string
): void {
    const fallbackParamNamesInOrder = fallbackParams.map((parameter) => normalizeDocParamName(parameter.name));
    const fallbackParamNames = new Set(fallbackParamNamesInOrder);
    const remappedFallbackBlock = remapUnmatchedParamDocLinesToFunctionOrder(fallbackBlock, fallbackParamNamesInOrder);
    const prunedFallbackBlock = removeParamDocLinesNotInFunctionSignature(remappedFallbackBlock, fallbackParamNames);
    const reorderedFallbackBlock = reorderDocParamLinesByFunctionOrder(prunedFallbackBlock, fallbackParamNamesInOrder);
    fallbackBlock.splice(0, fallbackBlock.length, ...reorderedFallbackBlock);

    const existingParams = collectExistingParamNames(fallbackBlock);
    for (const { name, defaultVal } of fallbackParams) {
        const cleanName = normalizeDocParamName(name);
        if (existingParams.has(cleanName)) {
            if (defaultVal === undefined) {
                updateExistingParamDocWithoutDefault(fallbackBlock, cleanName);
            } else {
                updateExistingFallbackParamWithDefault(fallbackBlock, cleanName, defaultVal);
            }
            continue;
        }

        appendMissingFallbackParamLine(fallbackBlock, indentation, cleanName, defaultVal);
    }
}

function hasConcreteReturnTextAfterLine(lines: ReadonlyArray<string>, startLineIndex: number): boolean {
    for (let index = startLineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        const returnMatch = /\breturn\b\s*([^;]*)/.exec(line);
        if (returnMatch) {
            const returnExpression = returnMatch[1].trim();
            if (returnExpression !== "" && returnExpression !== "undefined") {
                return true;
            }
        }

        if (/^\s*}\s*(?:;\s*)?$/.test(line)) {
            return false;
        }
    }

    return false;
}

function inferReturnDocTypeFromTextAfterLine(
    lines: ReadonlyArray<string>,
    startLineIndex: number,
    functionParameterNames: ReadonlySet<string>,
    docParamTypesByName: ReadonlyMap<string, string>
): string | null {
    let sawConcreteReturn = false;
    let inferredParamName: string | null = null;

    for (let index = startLineIndex + 1; index < lines.length; index += 1) {
        const line = lines[index];
        const returnMatch = /\breturn\b\s*([^;]*)/.exec(line);
        if (returnMatch) {
            const returnExpression = returnMatch[1].trim();
            if (returnExpression !== "" && returnExpression !== "undefined") {
                sawConcreteReturn = true;
                if (!/^[A-Za-z_]\w*$/u.test(returnExpression)) {
                    return null;
                }

                const cleanName = returnExpression.replace(/^_+/, "");
                if (!functionParameterNames.has(cleanName)) {
                    return null;
                }

                if (inferredParamName === null) {
                    inferredParamName = cleanName;
                } else if (inferredParamName !== cleanName) {
                    return null;
                }
            }
        }

        if (/^\s*}\s*(?:;\s*)?$/.test(line)) {
            break;
        }
    }

    if (!sawConcreteReturn || inferredParamName === null) {
        return null;
    }

    return docParamTypesByName.get(inferredParamName) ?? "any";
}

function isTextualNamedFunctionDeclarationLine(line: string): boolean {
    return /^\s*function\s+[A-Za-z_]\w*\s*\(/u.test(line);
}

function countTopLevelFunctionHeaders(lines: ReadonlyArray<string>): number {
    return lines.filter((line) => isTextualNamedFunctionDeclarationLine(line)).length;
}

function isTextualConstructorFunctionLine(line: string): boolean {
    return /\bfunction\b/u.test(line) && /\bconstructor\b/u.test(line);
}

function synthesizeTextFallbackDocCommentBlock({
    processedBlock,
    line,
    indentation,
    lines,
    lineIndex
}: {
    processedBlock: ReadonlyArray<string>;
    line: string;
    indentation: string;
    lines: ReadonlyArray<string>;
    lineIndex: number;
}): ReadonlyArray<string> {
    const fallbackParams = extractParamsFromLine(line);
    const fallbackBlock = Array.from(processedBlock);
    const fallbackParamNames = new Set(fallbackParams.map((parameter) => parameter.name));
    const fallbackParamTypesByName = collectDocCommentParamTypesByName(fallbackBlock);

    mergeFallbackParamLines(fallbackBlock, fallbackParams, indentation);

    const hasReturnLine = fallbackBlock.some((docLine) => /^\s*\/\/\/\s*@returns?/.test(docLine));
    const hasConcreteReturnText = hasConcreteReturnTextAfterLine(lines, lineIndex);
    const inferredReturnType = inferReturnDocTypeFromTextAfterLine(
        lines,
        lineIndex,
        fallbackParamNames,
        fallbackParamTypesByName
    );
    const functionHeaderCount = countTopLevelFunctionHeaders(lines);
    const isConstructorFunctionLine = isTextualConstructorFunctionLine(line);
    if (isConstructorFunctionLine && hasReturnLine) {
        removeReturnDocLines(fallbackBlock);
    }

    if (!hasReturnLine && !isConstructorFunctionLine) {
        if (inferredReturnType !== null) {
            fallbackBlock.push(`${indentation}/// @returns {${inferredReturnType}}`);
        } else if (!hasConcreteReturnText || functionHeaderCount === 1) {
            fallbackBlock.push(`${indentation}/// @returns {undefined}`);
        }
    }

    const alignedBlock = alignDescriptionContinuationLines(fallbackBlock);
    return Array.from(reorderFunctionDocLinesForCanonicalTagLayout(alignedBlock));
}

export function createNormalizeDocCommentsRule(definition: GmlRuleDefinition): Rule.RuleModule {
    return Object.freeze({
        meta: createMeta(definition),
        create(context) {
            return Object.freeze({
                Program(programNode) {
                    const text = context.sourceCode.text;
                    const lineEnding = Core.dominantLineEnding(text);
                    const lines = text.split(/\r?\n/u);
                    const lineStartOffsets = computeLineStartOffsets(text);
                    const functionNodesByLineIndex = collectFunctionNodesByStartLine(programNode, lineStartOffsets);
                    const rewrittenLines: Array<string> = [];
                    const deferredDocBlocksByLineIndex = new Map<number, Array<string>>();

                    let pendingDocBlock: Array<string> = [];
                    let pendingGapLinesAfterDocBlock: Array<string> = [];
                    for (const [lineIndex, line] of lines.entries()) {
                        // accumulate any doc-like lines until we hit actual code
                        if (
                            /^\s*\/\/\//u.test(line) ||
                            /^\s*\/\/\s*@/u.test(line) ||
                            /^\s*\/\/\s*\/(?!\/)/u.test(line)
                        ) {
                            if (pendingDocBlock.length > 0 && pendingGapLinesAfterDocBlock.length > 0) {
                                flushDetachedDocCommentBlock(
                                    rewrittenLines,
                                    pendingDocBlock,
                                    pendingGapLinesAfterDocBlock,
                                    true
                                );
                                pendingDocBlock = [];
                                pendingGapLinesAfterDocBlock = [];
                            }
                            pendingDocBlock.push(line);
                            continue;
                        }

                        if (pendingDocBlock.length > 0 && /^\s*$/u.test(line)) {
                            pendingGapLinesAfterDocBlock.push(line);
                            continue;
                        }

                        const astFunctionCandidate = functionNodesByLineIndex.get(lineIndex)?.[0] ?? null;
                        const hasAstNode = astFunctionCandidate !== null;
                        // when running under the minimalist test harness the AST will be
                        // just `{type:"Program"}` so the map will be empty; fall back to a
                        // simple regex to recognize function headers in that case.
                        const hasLeadingIndentation = /^\s+/u.test(line);
                        const isTextualFunctionDeclaration = isTextualNamedFunctionDeclarationLine(line);
                        const isTextualFunctionAssignment = /^\s*(?:var|static)\s+[A-Za-z_]\w*\s*=\s*function\b/u.test(
                            line
                        );
                        const isTextualFunction =
                            isTextualFunctionDeclaration ||
                            (isTextualFunctionAssignment && (pendingDocBlock.length > 0 || !hasLeadingIndentation));
                        const isFunctionLine = hasAstNode || isTextualFunction;

                        if (isFunctionLine) {
                            const indentationMatch = /^(\s*)/.exec(line);
                            const indentation = indentationMatch ? indentationMatch[1] : "";

                            const processedBlock = pendingDocBlock.length > 0 ? processDocBlock(pendingDocBlock) : [];
                            const synthesized = astFunctionCandidate
                                ? synthesizeFunctionDocCommentBlock(
                                      processedBlock,
                                      text,
                                      astFunctionCandidate.functionNode,
                                      !astFunctionCandidate.assignmentStyle ||
                                          !hasLeadingIndentation ||
                                          astFunctionCandidate.staticStyle,
                                      astFunctionCandidate.assignmentStyle,
                                      astFunctionCandidate.propertyStyle,
                                      astFunctionCandidate.staticStyle,
                                      hasLeadingIndentation
                                  )
                                : synthesizeTextFallbackDocCommentBlock({
                                      processedBlock,
                                      line,
                                      indentation,
                                      lines,
                                      lineIndex
                                  });

                            const deferredSynthesisHandled = handleDeferredDocSynthesis(
                                astFunctionCandidate,
                                synthesized ?? [],
                                text,
                                hasLeadingIndentation,
                                processedBlock,
                                lineStartOffsets,
                                deferredDocBlocksByLineIndex
                            );

                            if (synthesized !== null) {
                                if (synthesized.length > 0 && !deferredSynthesisHandled) {
                                    if (
                                        shouldSeparateTopLevelSynthesizedDocBlock(
                                            rewrittenLines,
                                            synthesized,
                                            hasLeadingIndentation
                                        )
                                    ) {
                                        rewrittenLines.push("");
                                    }
                                    rewrittenLines.push(...synthesized);
                                }
                            } else if (processedBlock.length > 0) {
                                rewrittenLines.push(...processedBlock);
                            }
                            pendingDocBlock = [];
                            pendingGapLinesAfterDocBlock = [];
                        } else {
                            flushDetachedDocCommentBlock(
                                rewrittenLines,
                                pendingDocBlock,
                                pendingGapLinesAfterDocBlock,
                                false
                            );
                            pendingDocBlock = [];
                            pendingGapLinesAfterDocBlock = [];
                        }

                        rewrittenLines.push(normalizeDocCommentPrefixLine(line));
                        const deferredDocBlock = deferredDocBlocksByLineIndex.get(lineIndex);
                        if (deferredDocBlock && deferredDocBlock.length > 0) {
                            rewrittenLines.push(...deferredDocBlock);
                        }
                    }

                    if (pendingDocBlock.length > 0) {
                        flushDetachedDocCommentBlock(
                            rewrittenLines,
                            pendingDocBlock,
                            pendingGapLinesAfterDocBlock,
                            false
                        );
                    }

                    const rewritten = rewrittenLines.join(lineEnding);
                    reportFullTextRewrite(context, definition.messageId, text, rewritten);
                }
            });
        }
    });
}

function getFunctionParameterNames(functionNode: any): { inOrder: string[]; set: Set<string> } {
    const params = functionNode.params || [];
    const inOrder: string[] = [];
    for (const param of params) {
        const parameterName = resolveParameterName(param);

        if (typeof parameterName !== "string" || parameterName.length === 0) {
            continue;
        }

        inOrder.push(normalizeDocParamName(parameterName));
    }
    return { inOrder, set: new Set(inOrder) };
}

function determineIfShouldSynthesizeReturnLine({
    assignmentStyle,
    propertyStyle,
    staticStyle,
    hadInputDocLines,
    hasLeadingIndentation,
    functionParameterNamesInOrder,
    returnInference,
    inferredReturnType,
    hasExistingReturnLine,
    suppressSyntheticReturns
}: {
    assignmentStyle: boolean;
    propertyStyle: boolean;
    staticStyle: boolean;
    hadInputDocLines: boolean;
    hasLeadingIndentation: boolean;
    functionParameterNamesInOrder: string[];
    returnInference: ReturnInferenceSummary;
    inferredReturnType: string;
    hasExistingReturnLine: boolean;
    suppressSyntheticReturns: boolean;
}): boolean {
    if (suppressSyntheticReturns) {
        return false;
    }

    const suppressUndocumentedAssignmentWithoutParams =
        assignmentStyle && !staticStyle && !hadInputDocLines && functionParameterNamesInOrder.length === 0;
    const suppressNestedUndocumentedNoParamConcreteReturn =
        !assignmentStyle &&
        !hadInputDocLines &&
        hasLeadingIndentation &&
        functionParameterNamesInOrder.length === 0 &&
        returnInference.hasConcreteReturn;
    const suppressDocOnlyNoParamConcreteReturn =
        !assignmentStyle &&
        hadInputDocLines &&
        functionParameterNamesInOrder.length === 0 &&
        !hasExistingReturnLine &&
        returnInference.hasConcreteReturn &&
        normalizeReturnTypeForComparison(inferredReturnType) !== "struct";
    const suppressUndocumentedNoParamPropertyFunctionReturn =
        propertyStyle && !hadInputDocLines && functionParameterNamesInOrder.length === 0;
    const suppressUndocumentedFunctionPropertyStructReturn =
        !assignmentStyle &&
        !hasExistingReturnLine &&
        returnInference.hasStructReturnWithFunctionProperties &&
        normalizeReturnTypeForComparison(inferredReturnType) === "struct";

    return (
        !suppressUndocumentedAssignmentWithoutParams &&
        !suppressNestedUndocumentedNoParamConcreteReturn &&
        !suppressDocOnlyNoParamConcreteReturn &&
        !suppressUndocumentedNoParamPropertyFunctionReturn &&
        !suppressUndocumentedFunctionPropertyStructReturn
    );
}

function handleDeferredDocSynthesis(
    astFunctionCandidate: any,
    synthesized: ReadonlyArray<string>,
    text: string,
    hasLeadingIndentation: boolean,
    processedBlock: ReadonlyArray<string>,
    lineStartOffsets: number[],
    deferredDocBlocksByLineIndex: Map<number, Array<string>>
): boolean {
    if (
        astFunctionCandidate &&
        synthesized &&
        synthesized.length > 0 &&
        astFunctionCandidate.assignmentStyle &&
        !hasLeadingIndentation &&
        processedBlock.length === 0 &&
        countNamedFunctionParameters(astFunctionCandidate.functionNode) > 0
    ) {
        const assignmentReturnSummary = inferReturnDocTypeFromFunctionNode(
            astFunctionCandidate.functionNode,
            new Set<string>(),
            new Map<string, string>()
        );
        if (!assignmentReturnSummary.hasReturnStatement) {
            const assignmentStartIndex = getNodeStartIndex(astFunctionCandidate.sourceNode);
            const assignmentEndIndex = Core.getNodeEndIndex(astFunctionCandidate.sourceNode);
            if (
                typeof assignmentStartIndex === "number" &&
                typeof assignmentEndIndex === "number" &&
                assignmentEndIndex > assignmentStartIndex
            ) {
                let assignmentSliceEndIndex = assignmentEndIndex;
                if (text[assignmentSliceEndIndex] === ";") {
                    assignmentSliceEndIndex += 1;
                }

                const assignmentText = text.slice(assignmentStartIndex, assignmentSliceEndIndex);
                const assignmentLines = assignmentText.split(/\r?\n/u);
                const assignmentEndLineIndex = getLineIndexForOffset(lineStartOffsets, assignmentEndIndex - 1);
                const deferredLines = ["", ...synthesized, ...assignmentLines];
                if (
                    hasMaterializedDeferredDocumentedAssignmentAfterSourceText(
                        text,
                        assignmentSliceEndIndex,
                        synthesized,
                        assignmentLines
                    )
                ) {
                    return true;
                }
                const existingDeferredLines = deferredDocBlocksByLineIndex.get(assignmentEndLineIndex) ?? [];
                existingDeferredLines.push(...deferredLines);
                deferredDocBlocksByLineIndex.set(assignmentEndLineIndex, existingDeferredLines);
                return true;
            }
        }
    }
    return false;
}

function hasMaterializedDeferredDocumentedAssignmentAfterSourceText(
    sourceText: string,
    assignmentSliceEndIndex: number,
    synthesizedDocLines: ReadonlyArray<string>,
    assignmentLines: ReadonlyArray<string>
): boolean {
    const followingLines = sourceText.slice(assignmentSliceEndIndex).split(/\r?\n/u);
    let lineIndex = 0;
    while (lineIndex < followingLines.length && followingLines[lineIndex].trim().length === 0) {
        lineIndex += 1;
    }

    if (lineIndex === 0) {
        return false;
    }

    const expectedLines = [...synthesizedDocLines, ...assignmentLines];
    if (followingLines.length - lineIndex < expectedLines.length) {
        return false;
    }

    for (const [expectedIndex, expectedLine] of expectedLines.entries()) {
        if (followingLines[lineIndex + expectedIndex] !== expectedLine) {
            return false;
        }
    }

    return true;
}
