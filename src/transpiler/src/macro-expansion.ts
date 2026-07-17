import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

type AstRecord = Record<string, unknown>;
const PRESERVED_IDENTIFIER_PARENT_TYPES = new Set([
    "CatchClause",
    "ConstructorDeclaration",
    "EnumMember",
    "FunctionDeclaration",
    "MacroDeclaration",
    "PropertyAssignment",
    "StructProperty",
    "VariableDeclarator"
]);

/**
 * A project macro captured from a parsed GML source file.
 *
 * The value is retained as source text because parser macro tokens do not
 * retain whitespace and therefore cannot safely reconstruct string literals,
 * keyword operators, comments, or escaped multiline directives.
 */
export interface MacroDefinition {
    readonly name: string;
    readonly parameters: ReadonlyArray<string>;
    readonly value: string;
    readonly sourcePath: string;
}

/** Macro definitions grouped by the source file that owns them. */
export type MacroDefinitionsBySourcePath = Map<string, ReadonlyMap<string, MacroDefinition>>;

/**
 * Extracts all `#macro` and `#define` macro declarations from a parsed AST.
 *
 * @param ast Parsed GML AST to inspect.
 * @param sourcePath Absolute path of the source file owning the declarations.
 * @param sourceText Original source text used to preserve directive values.
 * @returns Macro definitions keyed by macro name.
 */
export function extractMacroDefinitionsFromAst(
    ast: unknown,
    sourcePath: string,
    sourceText: string
): Map<string, MacroDefinition> {
    const definitions = new Map<string, MacroDefinition>();
    const visited = new WeakSet<object>();

    const visit = (value: unknown): void => {
        if (!Core.isObjectLike(value)) {
            return;
        }

        const objectValue = value as object;
        if (visited.has(objectValue)) {
            return;
        }
        visited.add(objectValue);

        if (Array.isArray(value)) {
            for (const entry of value) {
                visit(entry);
            }
            return;
        }

        const record = value as AstRecord;
        if (record.type === "MacroDeclaration") {
            const name = readIdentifierName(record.name);
            const replacement = name === null ? null : readMacroReplacement(record, name, sourceText);
            if (name !== null && replacement !== null) {
                definitions.set(name, {
                    name,
                    parameters: replacement.parameters,
                    value: replacement.value,
                    sourcePath
                });
            }
        }

        for (const [key, child] of Object.entries(record)) {
            if (key === "parent" || key === "enclosingNode" || key === "precedingNode" || key === "followingNode") {
                continue;
            }
            visit(child);
        }
    };

    visit(ast);
    return definitions;
}

/**
 * Creates a deterministic project-wide macro table from per-file definitions.
 *
 * GameMaker projects can contain macro declarations in any GML resource. The
 * watch scan is concurrent, so insertion order from that scan is not a stable
 * conflict rule. Sorting paths makes duplicate-name behavior reproducible;
 * the later path wins, matching the source-order overwrite behavior of the
 * parser when declarations occur in one file.
 *
 * @param definitionsBySourcePath Per-file macro definitions.
 * @returns Project-wide macro table keyed by macro name.
 */
export function createProjectMacroDefinitions(
    definitionsBySourcePath: MacroDefinitionsBySourcePath
): Map<string, MacroDefinition> {
    const projectDefinitions = new Map<string, MacroDefinition>();
    const sourcePaths = [...definitionsBySourcePath.keys()].toSorted();

    for (const sourcePath of sourcePaths) {
        const definitions = definitionsBySourcePath.get(sourcePath);
        if (!definitions) {
            continue;
        }

        for (const [name, definition] of definitions) {
            projectDefinitions.set(name, definition);
        }
    }

    return projectDefinitions;
}

/**
 * Finds macro names whose effective definition changed between two project snapshots.
 *
 * The name set alone is insufficient for watch invalidation: changing a macro's
 * replacement text must recompile consumers even when the declaration remains
 * present. The source owner is included because duplicate-name resolution can
 * move to a different file without changing the replacement text.
 *
 * @param previousDefinitions Previous effective project macro table.
 * @param nextDefinitions Next effective project macro table.
 * @returns Sorted macro names whose effective definitions differ.
 */
export function findChangedMacroDefinitionNames(
    previousDefinitions: ReadonlyMap<string, MacroDefinition>,
    nextDefinitions: ReadonlyMap<string, MacroDefinition>
): Array<string> {
    const names = new Set([...previousDefinitions.keys(), ...nextDefinitions.keys()]);
    return [...names]
        .filter((name) => !areMacroDefinitionsEqual(previousDefinitions.get(name), nextDefinitions.get(name)))
        .toSorted();
}

function areMacroDefinitionsEqual(
    previousDefinition: MacroDefinition | undefined,
    nextDefinition: MacroDefinition | undefined
): boolean {
    if (previousDefinition === undefined || nextDefinition === undefined) {
        return previousDefinition === nextDefinition;
    }

    return (
        previousDefinition.name === nextDefinition.name &&
        previousDefinition.sourcePath === nextDefinition.sourcePath &&
        previousDefinition.value === nextDefinition.value &&
        previousDefinition.parameters.length === nextDefinition.parameters.length &&
        previousDefinition.parameters.every((parameter, index) => parameter === nextDefinition.parameters[index])
    );
}

/**
 * Extracts project macro names referenced by a parsed source AST.
 *
 * The returned names are stable and exclude macro declarations, member
 * property names, and lexical binding positions. Callers can turn them into
 * dependency symbols without duplicating AST classification logic.
 *
 * @param ast Parsed GML AST to inspect.
 * @param definitions Project-wide macro definitions to recognize.
 * @returns Sorted, de-duplicated macro names referenced by the AST.
 */
export function extractMacroReferencesFromAst(
    ast: unknown,
    definitions: ReadonlyMap<string, MacroDefinition>
): Array<string> {
    return [...collectExpandableMacroReferences(ast, definitions)].toSorted();
}

/**
 * Expands project macros in a cloned AST before per-function transpilation.
 *
 * Macro expansion belongs before patch splitting: a macro can introduce an
 * array/member expression, a script alias, or a call that must be visible to
 * both the emitter and per-patch dependency extraction. The input AST is not
 * mutated, which keeps the initial-scan cache and symbol/reference analysis
 * reusable.
 *
 * @param ast Parsed GML AST to clone and transform.
 * @param definitions Project-wide macro definitions.
 * @returns A cloned AST with resolvable macro references expanded.
 */
export function expandProjectMacros(
    ast: unknown,
    definitions: ReadonlyMap<string, MacroDefinition>,
    sourcePath: string
): unknown {
    if (definitions.size === 0 || !Core.isObjectLike(ast) || !containsExpandableMacroReference(ast, definitions)) {
        return ast;
    }

    const clonedAst = Core.cloneAstNode(ast);
    return transformAstValue(clonedAst, definitions, sourcePath, new Set<string>(), null);
}

function containsExpandableMacroReference(
    value: unknown,
    definitions: ReadonlyMap<string, MacroDefinition>,
    parentContext: ParentAstContext | null = null,
    visited: WeakSet<object> = new WeakSet<object>()
): boolean {
    return collectExpandableMacroReferences(value, definitions, parentContext, visited).size > 0;
}

function collectExpandableMacroReferences(
    value: unknown,
    definitions: ReadonlyMap<string, MacroDefinition>,
    parentContext: ParentAstContext | null = null,
    visited: WeakSet<object> = new WeakSet<object>(),
    references: Set<string> = new Set<string>(),
    boundNames: ReadonlySet<string> = new Set<string>()
): Set<string> {
    if (!Core.isObjectLike(value)) {
        return references;
    }

    const objectValue = value as object;
    if (visited.has(objectValue)) {
        return references;
    }
    visited.add(objectValue);

    if (Array.isArray(value)) {
        for (const entry of value) {
            collectExpandableMacroReferences(entry, definitions, parentContext, visited, references, boundNames);
        }
        return references;
    }

    const record = value as AstRecord;
    if (record.type === "MacroDeclaration") {
        const name = readIdentifierName(record.name);
        const definition = name === null ? undefined : definitions.get(name);
        if (definition) {
            collectMacroReplacementReferences(definition, definitions, references);
        }
        return references;
    }

    if (record.type === "IdentifierStatement") {
        const name = readIdentifierName(record.name);
        if (name !== null && !boundNames.has(name) && definitions.has(name)) {
            references.add(name);
        }
    }

    if (record.type === "Identifier" && !shouldPreserveIdentifier(parentContext)) {
        const name = typeof record.name === "string" ? record.name : null;
        if (name !== null && !boundNames.has(name) && definitions.has(name)) {
            references.add(name);
        }
    }

    for (const [key, child] of Object.entries(record)) {
        if (key === "parent" || key === "enclosingNode" || key === "precedingNode" || key === "followingNode") {
            continue;
        }
        collectExpandableMacroReferences(
            child,
            definitions,
            {
                parentType: typeof record.type === "string" ? record.type : null,
                key
            },
            visited,
            references,
            boundNames
        );
    }

    return references;
}

function readIdentifierName(value: unknown): string | null {
    if (typeof value === "string") {
        return value;
    }
    if (!Core.isObjectLike(value)) {
        return null;
    }

    const name = (value as AstRecord).name;
    return typeof name === "string" ? name : null;
}

interface MacroReplacement {
    readonly parameters: ReadonlyArray<string>;
    readonly value: string;
}

function readMacroReplacement(record: AstRecord, name: string, sourceText: string): MacroReplacement | null {
    const start = typeof record.start === "number" ? record.start : null;
    const end = typeof record.end === "number" ? record.end : null;
    const keyword = record.keyword === "define" ? "define" : "macro";

    if (start !== null && end !== null && start >= 0 && end >= start && end <= sourceText.length) {
        const declarationText = sourceText.slice(start, Math.min(sourceText.length, end + 1));
        const replacement = parseMacroReplacementText(declarationText, keyword, name);
        if (replacement !== null) {
            return replacement;
        }
    }

    const tokens = record.tokens;
    if (!Array.isArray(tokens)) {
        return null;
    }

    const tokenText = tokens.filter((token): token is string => typeof token === "string").join("");
    return parseMacroReplacementSuffix(tokenText, keyword);
}

function parseMacroReplacementText(text: string, keyword: string, name: string): MacroReplacement | null {
    const header = new RegExp(String.raw`^\s*#${keyword}[ \t]+${name}`, "u").exec(text);
    if (!header) {
        return null;
    }

    return parseMacroReplacementSuffix(text.slice(header[0].length), keyword);
}

function parseMacroReplacementSuffix(suffix: string, keyword: string): MacroReplacement {
    let replacement = suffix;
    let parameters: Array<string> = [];

    // GameMaker's function-like form is used with #define. A #macro value may
    // legitimately begin with `(`, so only an immediately adjacent parenthesis
    // after #define's name is treated as a parameter list.
    if (keyword === "define" && replacement.startsWith("(")) {
        const closingParenthesis = replacement.indexOf(")");
        if (closingParenthesis > 0) {
            parameters = replacement
                .slice(1, closingParenthesis)
                .split(",")
                .map((parameter) => parameter.trim())
                .filter((parameter) => parameter.length > 0);
            replacement = replacement.slice(closingParenthesis + 1);
        }
    }

    return {
        parameters,
        value: normalizeMacroSourceValue(replacement)
    };
}

function collectMacroReplacementReferences(
    definition: MacroDefinition,
    definitions: ReadonlyMap<string, MacroDefinition>,
    references: Set<string>
): void {
    try {
        const expression = parseMacroExpression(definition);
        const visited = new WeakSet<object>();
        const boundNames = new Set(definition.parameters);
        collectExpandableMacroReferences(expression, definitions, null, visited, references, boundNames);
    } catch {
        try {
            const statements = parseMacroFunctionBody(definition.value);
            const visited = new WeakSet<object>();
            const boundNames = new Set(definition.parameters);
            for (const statement of statements) {
                collectExpandableMacroReferences(statement, definitions, null, visited, references, boundNames);
            }
        } catch {
            // Invalid replacements are reported when the macro is expanded. A
            // dependency scan must remain able to track the rest of the project.
        }
    }
}

function normalizeMacroSourceValue(value: string | undefined): string {
    return (value ?? "")
        .replaceAll(/\\\r?\n/gu, " ")
        .replaceAll("\\\n", " ")
        .trim();
}

function transformAstValue(
    value: unknown,
    definitions: ReadonlyMap<string, MacroDefinition>,
    sourcePath: string,
    expansionStack: Set<string>,
    parentContext: ParentAstContext | null,
    parameterBindings: ReadonlyMap<string, unknown> = new Map<string, unknown>()
): unknown {
    if (!Core.isObjectLike(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        const transformedEntries: Array<unknown> = [];
        for (const entry of value) {
            const transformedEntry = transformAstValue(
                entry,
                definitions,
                sourcePath,
                expansionStack,
                parentContext,
                parameterBindings
            );
            if (transformedEntry === null || transformedEntry === undefined) {
                continue;
            }
            if (Array.isArray(transformedEntry)) {
                transformedEntries.push(...transformedEntry);
            } else {
                transformedEntries.push(transformedEntry);
            }
        }
        return transformedEntries;
    }

    const record = value as AstRecord;
    if (record.type === "MacroDeclaration") {
        return null;
    }

    if (record.type === "CallExpression") {
        const callTarget = record.object ?? record.callee;
        const targetName = Core.isObjectLike(callTarget) ? readIdentifierName(callTarget) : null;
        const definition = targetName === null ? undefined : definitions.get(targetName);
        if (definition && definition.parameters.length > 0) {
            return expandMacroCall(record, definition, definitions, sourcePath, expansionStack, parameterBindings);
        }
    }

    if (record.type === "IdentifierStatement") {
        const name = readIdentifierName(record.name);
        const definition = name === null ? undefined : definitions.get(name);
        if (definition) {
            return expandMacroStatements(definition, definitions, sourcePath, expansionStack);
        }
    }

    if (record.type === "Identifier" && !shouldPreserveIdentifier(parentContext)) {
        const name = typeof record.name === "string" ? record.name : null;
        if (name !== null && parameterBindings.has(name)) {
            return cloneAstWithoutTraversalLinks(parameterBindings.get(name));
        }
        const definition = name === null ? undefined : definitions.get(name);
        if (definition) {
            return expandMacroDefinition(definition, definitions, sourcePath, expansionStack, new Map());
        }
    }

    const transformed: AstRecord = {};
    for (const [key, child] of Object.entries(record)) {
        if (key === "parent" || key === "enclosingNode" || key === "precedingNode" || key === "followingNode") {
            continue;
        }

        transformed[key] = transformAstValue(
            child,
            definitions,
            sourcePath,
            expansionStack,
            {
                parentType: typeof record.type === "string" ? record.type : null,
                key
            },
            parameterBindings
        );
    }

    return transformed;
}

function cloneAstWithoutTraversalLinks(value: unknown): unknown {
    if (!Core.isObjectLike(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => cloneAstWithoutTraversalLinks(entry));
    }

    const record = value as AstRecord;
    const clone: AstRecord = {};
    for (const [key, child] of Object.entries(record)) {
        if (key === "parent" || key === "enclosingNode" || key === "precedingNode" || key === "followingNode") {
            continue;
        }
        clone[key] = cloneAstWithoutTraversalLinks(child);
    }
    return clone;
}

function expandMacroDefinition(
    definition: MacroDefinition,
    definitions: ReadonlyMap<string, MacroDefinition>,
    sourcePath: string,
    expansionStack: Set<string>,
    parameterBindings: ReadonlyMap<string, unknown>
): unknown {
    if (expansionStack.has(definition.name)) {
        const chain = [...expansionStack, definition.name].join(" -> ");
        throw new TypeError(`Cyclic macro expansion while transpiling ${sourcePath}: ${chain}`);
    }

    const macroAst = parseMacroExpression(definition);
    const nextStack = new Set(expansionStack);
    nextStack.add(definition.name);
    return transformAstValue(macroAst, definitions, sourcePath, nextStack, null, parameterBindings);
}

function expandMacroCall(
    call: AstRecord,
    definition: MacroDefinition,
    definitions: ReadonlyMap<string, MacroDefinition>,
    sourcePath: string,
    expansionStack: Set<string>,
    parameterBindings: ReadonlyMap<string, unknown>
): unknown {
    const argumentsList = Array.isArray(call.arguments) ? call.arguments : [];
    if (argumentsList.length !== definition.parameters.length) {
        throw new TypeError(
            `Macro ${definition.name} from ${definition.sourcePath} expects ${definition.parameters.length} argument(s), received ${argumentsList.length}`
        );
    }

    const bindings = new Map<string, unknown>();
    for (const [index, parameter] of definition.parameters.entries()) {
        const argument = argumentsList[index];
        bindings.set(
            parameter,
            transformAstValue(argument, definitions, sourcePath, expansionStack, null, parameterBindings)
        );
    }

    return expandMacroDefinition(definition, definitions, sourcePath, expansionStack, bindings);
}

function parseMacroExpression(definition: MacroDefinition): unknown {
    if (definition.value.length === 0) {
        throw new TypeError(`Macro ${definition.name} in ${definition.sourcePath} has no replacement value`);
    }

    try {
        const statements = parseMacroFunctionBody(`return ${definition.value}\n;`);
        const returnStatement = statements.find(
            (node): node is AstRecord => Core.isObjectLike(node) && node.type === "ReturnStatement"
        );
        const argument = returnStatement?.argument;
        if (!Core.isObjectLike(argument)) {
            throw new TypeError("macro replacement is not an expression");
        }
        return argument;
    } catch (error) {
        const message = Core.getErrorMessage(error, { fallback: "invalid macro replacement" });
        throw new TypeError(`Could not expand macro ${definition.name} from ${definition.sourcePath}: ${message}`, {
            cause: error
        });
    }
}

function expandMacroStatements(
    definition: MacroDefinition,
    definitions: ReadonlyMap<string, MacroDefinition>,
    sourcePath: string,
    expansionStack: Set<string>
): Array<unknown> {
    if (expansionStack.has(definition.name)) {
        const chain = [...expansionStack, definition.name].join(" -> ");
        throw new TypeError(`Cyclic macro expansion while transpiling ${sourcePath}: ${chain}`);
    }

    const nextStack = new Set(expansionStack);
    nextStack.add(definition.name);
    try {
        const statements = parseMacroFunctionBody(definition.value);
        return statements.map((statement) =>
            transformAstValue(statement, definitions, sourcePath, nextStack, null, new Map())
        );
    } catch (error) {
        const message = Core.getErrorMessage(error, { fallback: "invalid macro statement replacement" });
        throw new TypeError(`Could not expand macro ${definition.name} from ${definition.sourcePath}: ${message}`, {
            cause: error
        });
    }
}

function parseMacroFunctionBody(bodySource: string): Array<AstRecord> {
    const parser = new Parser.GMLParser(`function __gmloop_macro_value__() { ${bodySource}\n}`, {
        getComments: false,
        getLocations: false
    });
    const ast = parser.parse();
    const program = Core.isObjectLike(ast) ? (ast as AstRecord) : null;
    const body = program && Array.isArray(program.body) ? program.body : [];
    const functionNode = body.find(
        (node): node is AstRecord => Core.isObjectLike(node) && (node as AstRecord).type === "FunctionDeclaration"
    );
    const functionBody = functionNode && Core.isObjectLike(functionNode.body) ? (functionNode.body as AstRecord) : null;
    const statements = functionBody && Array.isArray(functionBody.body) ? functionBody.body : [];
    return statements.filter((statement): statement is AstRecord => Core.isObjectLike(statement));
}

interface ParentAstContext {
    readonly parentType: string | null;
    readonly key: string;
}

function shouldPreserveIdentifier(parentContext: ParentAstContext | null): boolean {
    if (!parentContext) {
        return false;
    }

    if (parentContext.parentType === "MemberDotExpression" && parentContext.key === "property") {
        return true;
    }

    if (parentContext.key === "idLocation") {
        return true;
    }

    if (parentContext.key === "name" || parentContext.key === "id") {
        return PRESERVED_IDENTIFIER_PARENT_TYPES.has(parentContext.parentType ?? "");
    }

    if (parentContext.key === "params") {
        return (
            parentContext.parentType === "ConstructorDeclaration" || parentContext.parentType === "FunctionDeclaration"
        );
    }

    if (parentContext.key === "propertyName" || parentContext.key === "key") {
        return true;
    }

    return false;
}
