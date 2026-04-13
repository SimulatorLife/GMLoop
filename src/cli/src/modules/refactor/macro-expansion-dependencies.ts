import * as fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";
import { Semantic } from "@gmloop/semantic";

import { readSemanticLocationIndex } from "./semantic-index-helpers.js";

type MacroIdentifierEntry = {
    declarations?: Array<Record<string, unknown>>;
};

type SemanticFileRecord = {
    references?: Array<Record<string, unknown>>;
};

type MacroDependencyContext = {
    files: Record<string, SemanticFileRecord>;
    macros: Record<string, MacroIdentifierEntry>;
    projectRoot: string;
    selectedFilePaths?: Array<string>;
};

type MacroExpansionDependency = {
    path: string;
    macroName: string;
    referencedNames: Array<string>;
};

export interface MacroDeclarationReferenceOccurrence {
    end: number;
    name: string;
    start: number;
}

export interface MacroDeclarationReferenceRecord {
    macroName: string;
    path: string;
    references: Array<MacroDeclarationReferenceOccurrence>;
}

const DEFAULT_DECLARATION_KEYWORDS = new Set(["enum", "function", "globalvar", "static", "var"]);
const BUILT_IN_IDENTIFIER_NAMES = new Set(
    Core.normalizeIdentifierMetadataEntries(Core.getIdentifierMetadata()).map((entry) => entry.name.toLowerCase())
);
const MACRO_REFERENCE_PROBE_PREFIX = "function __gmloop_macro_probe__() {\n";
const MACRO_REFERENCE_PROBE_SUFFIX = "\n}\n";

function createSelectedFilePredicate(selectedFilePaths?: Array<string>): (candidatePath: string) => boolean {
    if (!Array.isArray(selectedFilePaths) || selectedFilePaths.length === 0) {
        return () => true;
    }

    const includedFiles = new Set(selectedFilePaths);
    return (candidatePath) => includedFiles.has(candidatePath);
}

function readMacroDeclarationFilePath(entry: MacroIdentifierEntry): string | null {
    for (const declaration of entry.declarations ?? []) {
        if (typeof declaration.filePath === "string") {
            return declaration.filePath;
        }
    }

    return null;
}

function normalizeMacroBody(tokens: ReadonlyArray<unknown>): string {
    return tokens
        .flatMap((token) => {
            if (typeof token !== "string") {
                return [];
            }

            return token === "\\" ? ["\n"] : [token];
        })
        .join(" ");
}

function shouldCollectMacroReferenceIdentifier(node: unknown): node is {
    classifications?: Array<string>;
    declaration?: unknown;
    name: string;
} {
    if (!Core.isIdentifierNode(node)) {
        return false;
    }

    const typedIdentifierNode = node as { name?: unknown };
    if (!Core.isNonEmptyString(typedIdentifierNode.name)) {
        return false;
    }

    const typedNode = node as {
        classifications?: Array<string>;
        declaration?: unknown;
        end?: unknown;
        start?: unknown;
    };
    const classifications = Core.asArray(typedNode.classifications);
    if (!classifications.includes("reference")) {
        return false;
    }

    if (Core.isObjectLike(typedNode.declaration)) {
        return false;
    }

    if (BUILT_IN_IDENTIFIER_NAMES.has(typedIdentifierNode.name.toLowerCase())) {
        return false;
    }
    return true;
}

function collectMacroReferenceNamesFromAst(bodySourceText: string): Set<string> {
    const ast = Parser.GMLParser.parse(
        `${MACRO_REFERENCE_PROBE_PREFIX}${bodySourceText}${MACRO_REFERENCE_PROBE_SUFFIX}`,
        {
            getComments: false,
            getLocations: true,
            simplifyLocations: false,
            scopeTrackerOptions: {
                enabled: true,
                createScopeTracker: () => new Semantic.SemanticScopeCoordinator()
            }
        }
    );
    const referenceNames = new Set<string>();

    Core.walkAst(ast, (node) => {
        if (!shouldCollectMacroReferenceIdentifier(node)) {
            return;
        }

        referenceNames.add(node.name);
    });

    return referenceNames;
}

function collectMacroReferenceNamesFromTokens(tokens: ReadonlyArray<unknown>): Set<string> {
    const referenceNames = new Set<string>();
    let previousToken = "";

    for (const token of tokens) {
        if (typeof token !== "string") {
            continue;
        }

        if (token === "\\") {
            previousToken = "";
            continue;
        }

        const isIdentifier = Core.GML_IDENTIFIER_NAME_PATTERN.test(token);
        if (
            isIdentifier &&
            !DEFAULT_DECLARATION_KEYWORDS.has(previousToken) &&
            !BUILT_IN_IDENTIFIER_NAMES.has(token.toLowerCase())
        ) {
            referenceNames.add(token);
        }

        previousToken = token;
    }

    return referenceNames;
}

function collectStringLiteralRanges(bodySourceText: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const stringLiteralPattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;

    for (const match of bodySourceText.matchAll(stringLiteralPattern)) {
        if (typeof match.index !== "number") {
            continue;
        }

        ranges.push({
            start: match.index,
            end: match.index + match[0].length
        });
    }

    return ranges;
}

function collectMacroReferenceOccurrencesFromSource(
    bodySourceText: string,
    referencedNames: ReadonlySet<string>
): Array<MacroDeclarationReferenceOccurrence> {
    const referenceOccurrences: Array<MacroDeclarationReferenceOccurrence> = [];
    const stringLiteralRanges = collectStringLiteralRanges(bodySourceText);

    for (const referencedName of [...referencedNames].sort((left, right) => right.length - left.length)) {
        const escapedName = Core.escapeRegExp(referencedName);
        const namePattern = new RegExp(`(?<=^|[^A-Za-z0-9_])${escapedName}(?=[^A-Za-z0-9_]|$)`, "g");

        for (const match of bodySourceText.matchAll(namePattern)) {
            const start = match.index;
            if (typeof start !== "number") {
                continue;
            }

            const end = start + referencedName.length;
            if (stringLiteralRanges.some((range) => start >= range.start && end <= range.end)) {
                continue;
            }

            referenceOccurrences.push({
                name: referencedName,
                start,
                end
            });
        }
    }

    return referenceOccurrences.toSorted((left, right) => left.start - right.start);
}

function collectMacroReferenceNames(tokens: ReadonlyArray<unknown>): Set<string> {
    const normalizedBody = normalizeMacroBody(tokens).trim();
    if (normalizedBody.length === 0) {
        return new Set();
    }

    try {
        return collectMacroReferenceNamesFromAst(normalizedBody);
    } catch {
        return collectMacroReferenceNamesFromTokens(tokens);
    }
}

function readMacroBodyStartIndex(statement: {
    keywordRange?: unknown;
    name?: unknown;
    start?: unknown;
}): number | null {
    const macroNameNode = Core.isIdentifierNode(statement.name) ? (statement.name as { end?: unknown }) : null;
    const macroNameEnd = readSemanticLocationIndex(macroNameNode?.end);
    if (typeof macroNameEnd === "number") {
        return macroNameEnd + 1;
    }

    const keywordRange = Core.isObjectLike(statement.keywordRange)
        ? (statement.keywordRange as { end?: unknown })
        : null;
    if (typeof keywordRange?.end === "number") {
        return keywordRange.end;
    }

    return readSemanticLocationIndex(statement.start);
}

function collectMacroDeclarationReferenceRecordsFromFile(
    filePath: string,
    sourceText: string
): Array<MacroDeclarationReferenceRecord> {
    let ast: Record<string, unknown>;

    try {
        ast = Parser.GMLParser.parse(sourceText, {
            getComments: false,
            getLocations: true,
            simplifyLocations: false
        }) as Record<string, unknown>;
    } catch {
        return [];
    }

    const records: Array<MacroDeclarationReferenceRecord> = [];

    for (const statement of Core.asArray(ast.body)) {
        if (!Core.isObjectLike(statement)) {
            continue;
        }

        const macroStatement = statement as {
            end?: unknown;
            keywordRange?: unknown;
            name?: unknown;
            start?: unknown;
            tokens?: unknown;
            type?: string;
        };
        if (macroStatement.type !== "MacroDeclaration") {
            continue;
        }

        const macroNameNode = macroStatement.name;
        const typedMacroNameNode = Core.isIdentifierNode(macroNameNode) ? (macroNameNode as { name?: unknown }) : null;
        const macroName =
            typedMacroNameNode && Core.isNonEmptyString(typedMacroNameNode.name) ? typedMacroNameNode.name : null;
        if (!macroName) {
            continue;
        }

        const bodyStart = readMacroBodyStartIndex(macroStatement);
        const statementEnd = readSemanticLocationIndex(macroStatement.end);
        const bodyEnd = typeof statementEnd === "number" ? statementEnd + 1 : sourceText.length;
        if (typeof bodyStart !== "number" || bodyEnd <= bodyStart) {
            records.push({
                macroName,
                path: filePath,
                references: []
            });
            continue;
        }

        const bodySourceText = sourceText.slice(bodyStart, bodyEnd);
        const referencedNames = collectMacroReferenceNames(Core.asArray(macroStatement.tokens));
        const references = collectMacroReferenceOccurrencesFromSource(bodySourceText, referencedNames).map(
            (occurrence) => ({
                name: occurrence.name,
                start: bodyStart + occurrence.start,
                end: bodyStart + occurrence.end
            })
        );

        records.push({
            macroName,
            path: filePath,
            references
        });
    }

    return records;
}

/**
 * Parse macro declaration files and return exact identifier occurrences from each
 * macro body so callers can update cross-file references embedded in `#macro`
 * expansions.
 */
export function listMacroDeclarationReferenceRecords(
    context: Pick<MacroDependencyContext, "macros" | "projectRoot">
): Array<MacroDeclarationReferenceRecord> {
    const records: Array<MacroDeclarationReferenceRecord> = [];
    const parsedMacroFiles = new Set<string>();

    for (const entry of Object.values(context.macros)) {
        const declarationFilePath = readMacroDeclarationFilePath(entry);
        if (!declarationFilePath || parsedMacroFiles.has(declarationFilePath)) {
            continue;
        }

        parsedMacroFiles.add(declarationFilePath);
        const absoluteFilePath = path.resolve(context.projectRoot, declarationFilePath);
        if (!fs.existsSync(absoluteFilePath)) {
            continue;
        }

        let sourceText: string;
        try {
            sourceText = fs.readFileSync(absoluteFilePath, "utf8");
        } catch {
            continue;
        }

        records.push(...collectMacroDeclarationReferenceRecordsFromFile(declarationFilePath, sourceText));
    }

    return records;
}

function collectMacroDependencyNamesByMacro(
    macros: Record<string, MacroIdentifierEntry>,
    projectRoot: string
): Map<string, Set<string>> {
    const dependencyNamesByMacro = new Map<string, Set<string>>();

    for (const record of listMacroDeclarationReferenceRecords({ macros, projectRoot })) {
        const dependencyNames = dependencyNamesByMacro.get(record.macroName) ?? new Set<string>();

        for (const reference of record.references) {
            dependencyNames.add(reference.name);
        }

        dependencyNamesByMacro.set(record.macroName, dependencyNames);
    }

    return dependencyNamesByMacro;
}

function readMacroReferenceName(reference: Record<string, unknown>): string | null {
    const name = typeof reference.targetName === "string" ? reference.targetName : reference.name;
    return typeof name === "string" ? name : null;
}

/**
 * Resolve caller-scoped identifier dependencies introduced by bare macro
 * invocations in the selected project files.
 */
export function listMacroExpansionDependencies(context: MacroDependencyContext): Array<MacroExpansionDependency> {
    const shouldIncludePath = createSelectedFilePredicate(context.selectedFilePaths);
    const dependencyNamesByMacro = collectMacroDependencyNamesByMacro(context.macros, context.projectRoot);
    const dependencies: Array<MacroExpansionDependency> = [];
    const seenDependencyKeys = new Set<string>();

    for (const [filePath, fileRecord] of Object.entries(context.files)) {
        if (!shouldIncludePath(filePath)) {
            continue;
        }

        for (const reference of fileRecord.references ?? []) {
            if (!Core.isObjectLike(reference)) {
                continue;
            }

            const macroName = readMacroReferenceName(reference);
            if (!macroName) {
                continue;
            }

            const referencedNames = dependencyNamesByMacro.get(macroName);
            if (!referencedNames || referencedNames.size === 0) {
                continue;
            }

            const dependencyKey = `${filePath}:${macroName}`;
            if (seenDependencyKeys.has(dependencyKey)) {
                continue;
            }

            seenDependencyKeys.add(dependencyKey);
            dependencies.push({
                path: filePath,
                macroName,
                referencedNames: [...referencedNames].sort()
            });
        }
    }

    return dependencies;
}
