import { Core, type EmptyTransformOptions, type MutableGameMakerAstNode } from "@gmloop/core";

import { collectIdentifierNamesInSubtree } from "../rule-base-helpers.js";
import { applyLogicalExpressionCondensation } from "./logical-expression-condensation.js";

type StatementList = Array<MutableGameMakerAstNode | null | undefined>;
type MutableAstRecord = MutableGameMakerAstNode & Record<string, unknown>;

const IGNORED_CHILD_KEYS = new Set([
    "start",
    "end",
    "comments",
    "parent",
    "enclosingNode",
    "precedingNode",
    "followingNode"
]);

function execute(ast: MutableGameMakerAstNode, _options: EmptyTransformOptions): MutableGameMakerAstNode {
    applyLogicalExpressionCondensation(ast);
    eliminateRedundantTemporaryReturns(ast);
    optimizeConditionalMemberAccessCaching(ast);
    return ast;
}

function eliminateRedundantTemporaryReturns(ast: MutableGameMakerAstNode): void {
    const body = Array.isArray(ast.body) ? (ast.body as StatementList) : null;
    if (!body) {
        return;
    }

    processStatementListForTempReturnElimination(body);
}

function processStatementListForTempReturnElimination(statements: StatementList): void {
    if (!Array.isArray(statements)) {
        return;
    }

    for (const statement of statements) {
        if (!Core.isObjectLike(statement)) {
            continue;
        }

        visitStatementChildrenForTempReturnElimination(statement);
    }

    for (let index = 0; index < statements.length - 1; index += 1) {
        const replacement = maybeBuildRedundantTempReturnReplacement(statements[index], statements[index + 1]);
        if (!replacement) {
            continue;
        }

        statements.splice(index, 2, replacement);
    }
}

function visitStatementChildrenWithStatementListProcessor(
    statement: MutableGameMakerAstNode,
    processStatementList: (statements: StatementList) => void,
    visitStatementChildren: (statement: MutableGameMakerAstNode) => void
): void {
    const nodeRecord = statement;

    if (Array.isArray(nodeRecord.body)) {
        processStatementList(nodeRecord.body as StatementList);
    } else if (Core.isObjectLike(nodeRecord.body)) {
        visitStatementChildren(nodeRecord.body);
    }

    if (statement.type === "IfStatement") {
        if (Core.isObjectLike(statement.consequent)) {
            visitStatementChildren(statement.consequent as MutableGameMakerAstNode);
        }
        if (Core.isObjectLike(statement.alternate)) {
            visitStatementChildren(statement.alternate as MutableGameMakerAstNode);
        }
    }

    if (Array.isArray(statement.cases)) {
        for (const caseNode of statement.cases) {
            if (!Core.isObjectLike(caseNode)) {
                continue;
            }

            visitStatementChildren(caseNode as MutableGameMakerAstNode);
            if (Array.isArray((caseNode as MutableAstRecord).body)) {
                processStatementList((caseNode as MutableAstRecord).body as StatementList);
            }
        }
    }
}

function visitStatementChildrenForTempReturnElimination(statement: MutableGameMakerAstNode): void {
    visitStatementChildrenWithStatementListProcessor(
        statement,
        processStatementListForTempReturnElimination,
        visitStatementChildrenForTempReturnElimination
    );
}

function maybeBuildRedundantTempReturnReplacement(
    declarationStatement: MutableGameMakerAstNode | null | undefined,
    returnStatement: MutableGameMakerAstNode | null | undefined
): MutableGameMakerAstNode | null {
    if (!Core.isObjectLike(declarationStatement) || !Core.isObjectLike(returnStatement)) {
        return null;
    }

    if (declarationStatement.type !== "VariableDeclaration" || returnStatement.type !== "ReturnStatement") {
        return null;
    }

    if (Core.hasComment(declarationStatement) || Core.hasComment(returnStatement)) {
        return null;
    }

    const declarations = Core.asArray<MutableAstRecord>(declarationStatement.declarations);
    if (declarations.length !== 1) {
        return null;
    }

    const declarator = declarations[0];
    if (!Core.isObjectLike(declarator) || declarator.type !== "VariableDeclarator") {
        return null;
    }

    const temporaryName = Core.getIdentifierText(declarator.id);
    const initializer = declarator.init as MutableGameMakerAstNode | null | undefined;
    if (!temporaryName || !initializer || Core.hasComment(initializer)) {
        return null;
    }

    const returnArgument = returnStatement.argument as MutableGameMakerAstNode | null | undefined;
    if (
        !returnArgument ||
        Core.getIdentifierText(returnArgument) !== temporaryName ||
        Core.hasComment(returnArgument)
    ) {
        return null;
    }

    return {
        type: "ReturnStatement",
        argument: Core.cloneAstNode(initializer),
        start: Core.cloneLocation(declarationStatement.start),
        end: Core.cloneLocation(returnStatement.end)
    };
}

function optimizeConditionalMemberAccessCaching(ast: MutableGameMakerAstNode): void {
    const body = Array.isArray(ast.body) ? (ast.body as StatementList) : null;
    if (!body) {
        return;
    }

    processStatementListForMemberCaching(body);
}

function processStatementListForMemberCaching(statements: StatementList): void {
    if (!Array.isArray(statements)) {
        return;
    }

    for (let index = 0; index < statements.length; index += 1) {
        let statement = statements[index];
        if (!Core.isObjectLike(statement)) {
            continue;
        }

        let insertionOffset = 0;

        if (statement.type === "IfStatement") {
            insertionOffset += maybeCacheRepeatedMemberAccessForIfStatement(
                statement,
                statements,
                index + insertionOffset
            );
        }

        if (Core.isLoopLikeNode(statement)) {
            insertionOffset += maybeHoistInvariantLoopCondition(statement, statements, index + insertionOffset);
        }

        if (insertionOffset > 0) {
            index += insertionOffset;
            statement = statements[index];
            if (!Core.isObjectLike(statement)) {
                continue;
            }
        }

        visitStatementChildrenForMemberCaching(statement);
    }
}

function visitStatementChildrenForMemberCaching(statement: MutableGameMakerAstNode): void {
    visitStatementChildrenWithStatementListProcessor(
        statement,
        processStatementListForMemberCaching,
        visitStatementChildrenForMemberCaching
    );
}

function maybeCacheRepeatedMemberAccessForIfStatement(
    statement: MutableGameMakerAstNode,
    statements: StatementList,
    statementIndex: number
): number {
    if (!Core.isObjectLike(statement) || statement.type !== "IfStatement") {
        return 0;
    }

    if (Core.hasComment(statement) || Core.hasComment(statement.test) || !Core.isObjectLike(statement.test)) {
        return 0;
    }

    const occurrenceCounts = collectMemberAccessOccurrenceCounts(statement.test);

    let selectedPath = "";
    let selectedCount = 0;

    for (const [path, count] of occurrenceCounts) {
        if (count < 2) {
            continue;
        }

        if (count > selectedCount || (count === selectedCount && path.length > selectedPath.length)) {
            selectedPath = path;
            selectedCount = count;
        }
    }

    if (!selectedPath || selectedCount < 2) {
        return 0;
    }

    const usedNames = new Set(collectIdentifierNamesInSubtree(statements));
    const cachedVariableName = createUniqueTemporaryName("__gml_cached_member", usedNames);

    const conditionRoot = { test: statement.test };
    const replacedCount = replaceMemberAccessPath(conditionRoot, "test", selectedPath, cachedVariableName);
    const nextTest = conditionRoot.test;

    if (replacedCount < 2 || !Core.isObjectLike(nextTest)) {
        return 0;
    }

    statement.test = nextTest;

    const initializerNode = recreateMemberPathExpression(selectedPath, nextTest as MutableGameMakerAstNode);
    if (!initializerNode) {
        return 0;
    }

    const declaration = createCachedVariableDeclaration(cachedVariableName, initializerNode, statement.start);
    statements.splice(statementIndex, 0, declaration);
    return 1;
}

function maybeHoistInvariantLoopCondition(
    statement: MutableGameMakerAstNode,
    statements: StatementList,
    statementIndex: number
): number {
    if (!Core.isObjectLike(statement) || !Core.isLoopLikeNode(statement)) {
        return 0;
    }

    const loopCondition = getLoopConditionExpression(statement);
    if (!loopCondition || Core.hasComment(statement) || Core.hasComment(loopCondition)) {
        return 0;
    }

    const loopBody = statement.body as unknown;
    if (containsCallExpression(loopBody)) {
        return 0;
    }

    const assignedIdentifiers = new Set<string>();
    collectAssignedIdentifiersFromNode(loopBody, assignedIdentifiers);

    if (statement.type === "ForStatement" && Core.isObjectLike(statement.update)) {
        collectAssignedIdentifiersFromNode(statement.update, assignedIdentifiers);
    }

    const occurrenceCounts = collectMemberAccessOccurrenceCounts(loopCondition);

    let selectedPath = "";

    for (const [path] of occurrenceCounts) {
        const rootIdentifier = path.split(".")[0];
        if (!rootIdentifier || assignedIdentifiers.has(rootIdentifier)) {
            continue;
        }

        if (path.length > selectedPath.length) {
            selectedPath = path;
        }
    }

    if (!selectedPath) {
        return 0;
    }

    const usedNames = new Set(collectIdentifierNamesInSubtree(statements));
    const cachedVariableName = createUniqueTemporaryName("__gml_invariant_condition", usedNames);

    const conditionRecord = statement;
    const conditionRoot = { test: conditionRecord.test };
    const replacedCount = replaceMemberAccessPath(conditionRoot, "test", selectedPath, cachedVariableName);
    const nextTest = conditionRoot.test;

    if (replacedCount === 0 || !Core.isObjectLike(nextTest)) {
        return 0;
    }

    conditionRecord.test = nextTest;

    const initializerNode = recreateMemberPathExpression(selectedPath, loopCondition);
    if (!initializerNode) {
        return 0;
    }

    const declaration = createCachedVariableDeclaration(cachedVariableName, initializerNode, statement.start);
    statements.splice(statementIndex, 0, declaration);
    return 1;
}

function collectMemberAccessOccurrenceCounts(root: unknown): Map<string, number> {
    const counts = new Map<string, number>();

    walkNode(root, null, null, (node, parent, property) => {
        const path = getMemberAccessPath(node);
        if (!path || !isCollectibleMemberAccessNode(node, parent, property)) {
            return;
        }

        const existing = counts.get(path) ?? 0;
        counts.set(path, existing + 1);
    });

    return counts;
}

function replaceMemberAccessPath(
    parentContainer: Record<string, unknown> | Array<unknown>,
    property: string,
    targetPath: string,
    replacementIdentifier: string
): number {
    if (!targetPath || !replacementIdentifier) {
        return 0;
    }

    return replaceMemberAccessPathInternal(parentContainer, property, targetPath, replacementIdentifier);
}

function replaceMemberAccessPathInternal(
    parentContainer: Record<string, unknown> | Array<unknown>,
    property: string | number,
    targetPath: string,
    replacementIdentifier: string
): number {
    if (Array.isArray(parentContainer) && typeof property !== "number") {
        return 0;
    }
    if (!Array.isArray(parentContainer) && typeof property !== "string") {
        return 0;
    }

    const currentValue: unknown = Array.isArray(parentContainer)
        ? parentContainer[property as number]
        : parentContainer[property as string];

    if (!Core.isObjectLike(currentValue)) {
        return 0;
    }

    if (
        !Array.isArray(currentValue) &&
        isCollectibleMemberAccessNode(currentValue, parentContainer, property) &&
        getMemberAccessPath(currentValue) === targetPath
    ) {
        const replacement = Core.createIdentifierNode(replacementIdentifier, currentValue);
        if (!replacement) {
            return 0;
        }
        (parentContainer as Record<number | string, unknown>)[property] = replacement;
        return 1;
    }

    if (Array.isArray(currentValue)) {
        let replacements = 0;
        for (let index = 0; index < currentValue.length; index += 1) {
            replacements += replaceMemberAccessPathInternal(currentValue, index, targetPath, replacementIdentifier);
        }
        return replacements;
    }

    let replacements = 0;
    for (const [childKey, childValue] of Object.entries(currentValue)) {
        if (IGNORED_CHILD_KEYS.has(childKey) || !Core.isObjectLike(childValue)) {
            continue;
        }

        replacements += replaceMemberAccessPathInternal(
            currentValue as Record<string, unknown>,
            childKey,
            targetPath,
            replacementIdentifier
        );
    }

    return replacements;
}

function recreateMemberPathExpression(
    path: string,
    sourceNode: MutableGameMakerAstNode
): MutableGameMakerAstNode | null {
    const segments = path.split(".").filter((segment) => segment.length > 0);
    // A member access path requires at least two segments (e.g. "a.b").
    // Single-segment or empty paths are plain identifiers or invalid – not
    // something we need to reconstruct as a MemberDotExpression chain.
    if (segments.length < 2) {
        return null;
    }

    let expression: MutableGameMakerAstNode = {
        type: "Identifier",
        name: segments[0],
        start: Core.cloneLocation(sourceNode.start),
        end: Core.cloneLocation(sourceNode.end)
    };

    for (let index = 1; index < segments.length; index += 1) {
        expression = {
            type: "MemberDotExpression",
            object: expression,
            property: {
                type: "Identifier",
                name: segments[index],
                start: Core.cloneLocation(sourceNode.start),
                end: Core.cloneLocation(sourceNode.end)
            },
            start: Core.cloneLocation(sourceNode.start),
            end: Core.cloneLocation(sourceNode.end)
        };
    }

    return expression;
}

function getMemberAccessPath(node: unknown): string | null {
    if (!Core.isObjectLike(node)) {
        return null;
    }

    if ((node as MutableGameMakerAstNode).type === "Identifier") {
        return Core.getIdentifierText(node);
    }

    if ((node as MutableGameMakerAstNode).type !== "MemberDotExpression") {
        return null;
    }

    const nodeRecord = node as MutableAstRecord;
    const objectPath = getMemberAccessPath(nodeRecord.object);
    const propertyName = Core.getIdentifierText(nodeRecord.property);

    if (!objectPath || !propertyName) {
        return null;
    }

    return `${objectPath}.${propertyName}`;
}

function isCollectibleMemberAccessNode(
    node: unknown,
    parent: unknown,
    property: string | number | null
): node is MutableGameMakerAstNode {
    if (!Core.isObjectLike(node) || (node as MutableGameMakerAstNode).type !== "MemberDotExpression") {
        return false;
    }

    if (Core.hasComment(node)) {
        return false;
    }

    if (
        Core.isObjectLike(parent) &&
        (parent as MutableGameMakerAstNode).type === "MemberDotExpression" &&
        property === "object"
    ) {
        return false;
    }

    const memberPath = getMemberAccessPath(node);
    if (!memberPath) {
        return false;
    }

    // A MemberDotExpression always produces a path with at least two segments.
    // The original ">= 3" guard was overly restrictive: two-segment paths such
    // as "arr.length" or "obj.count" are equally valid candidates for caching
    // and invariant hoisting.  Only require the minimum depth that can actually
    // be represented as a MemberDotExpression.
    return memberPath.split(".").length >= 2;
}

function createCachedVariableDeclaration(
    identifierName: string,
    initializer: MutableGameMakerAstNode,
    startLocation: unknown
): MutableGameMakerAstNode {
    return {
        type: "VariableDeclaration",
        kind: "var",
        declarations: [
            {
                type: "VariableDeclarator",
                id: {
                    type: "Identifier",
                    name: identifierName
                },
                init: initializer
            }
        ],
        start: Core.cloneLocation(startLocation)
    };
}

function createUniqueTemporaryName(baseName: string, takenNames: Set<string>): string {
    if (!takenNames.has(baseName)) {
        takenNames.add(baseName);
        return baseName;
    }

    let suffix = 1;
    while (takenNames.has(`${baseName}_${suffix}`)) {
        suffix += 1;
    }

    const resolvedName = `${baseName}_${suffix}`;
    takenNames.add(resolvedName);
    return resolvedName;
}

function collectAssignedIdentifiersFromNode(node: unknown, assignedIdentifiers: Set<string>): void {
    walkNode(node, null, null, (child) => {
        if (child.type === "VariableDeclarator") {
            collectAssignedIdentifiersFromTarget(child.id, assignedIdentifiers);
            return;
        }

        if (child.type === "AssignmentExpression") {
            collectAssignedIdentifiersFromTarget(child.left, assignedIdentifiers);
            return;
        }

        if (Core.isIncDecNode(child)) {
            collectAssignedIdentifiersFromTarget(child.argument, assignedIdentifiers);
        }
    });
}

function collectAssignedIdentifiersFromTarget(target: unknown, assignedIdentifiers: Set<string>): void {
    if (!Core.isObjectLike(target)) {
        return;
    }

    if ((target as MutableGameMakerAstNode).type === "Identifier") {
        const identifierName = Core.getIdentifierText(target);
        if (identifierName) {
            assignedIdentifiers.add(identifierName);
        }
        return;
    }

    if ((target as MutableGameMakerAstNode).type === "MemberDotExpression") {
        collectAssignedIdentifiersFromTarget((target as MutableAstRecord).object, assignedIdentifiers);
        return;
    }

    if ((target as MutableGameMakerAstNode).type === "MemberIndexExpression") {
        collectAssignedIdentifiersFromTarget((target as MutableAstRecord).object, assignedIdentifiers);
        for (const name of collectIdentifierNamesInSubtree((target as MutableAstRecord).property)) {
            assignedIdentifiers.add(name);
        }
    }
}

function containsCallExpression(node: unknown): boolean {
    if (!Core.isObjectLike(node)) {
        return false;
    }

    if (Array.isArray(node)) {
        return node.some((element) => containsCallExpression(element));
    }

    const astNode = node as MutableGameMakerAstNode;
    if (astNode.type === "CallExpression") {
        return true;
    }

    return Object.entries(node).some(([key, value]) => {
        if (IGNORED_CHILD_KEYS.has(key) || !Core.isObjectLike(value)) {
            return false;
        }
        return containsCallExpression(value);
    });
}

function getLoopConditionExpression(loopNode: MutableGameMakerAstNode): MutableGameMakerAstNode | null {
    if (!Core.isLoopLikeNode(loopNode)) {
        return null;
    }

    const testNode = loopNode.test;
    return Core.isObjectLike(testNode) ? (testNode as MutableGameMakerAstNode) : null;
}

function walkNode(
    node: unknown,
    parent: unknown,
    property: string | number | null,
    callback: (node: MutableGameMakerAstNode, parent: unknown, property: string | number | null) => void
): void {
    if (!Core.isObjectLike(node)) {
        return;
    }

    if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
            walkNode(node[index], node, index, callback);
        }
        return;
    }

    const astNode = node as MutableGameMakerAstNode;
    callback(astNode, parent, property);

    for (const [childKey, childValue] of Object.entries(node)) {
        if (IGNORED_CHILD_KEYS.has(childKey) || !Core.isObjectLike(childValue)) {
            continue;
        }

        walkNode(childValue, node, childKey, callback);
    }
}

/** Pre-instantiated transform exposed for parser-normalization pipelines. */
export const optimizeLogicalExpressionsTransform = Core.createParserTransform<EmptyTransformOptions>(
    "optimize-logical-expressions",
    {},
    execute
);
