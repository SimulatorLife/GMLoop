import * as fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

import { pathExistsSync } from "../../shared/path-exists.js";

type ParsedLocalNamingCategory = "staticVariable" | "loopIndexVariable";

type ParsedLocalDeclarationMetadata = {
    category: ParsedLocalNamingCategory;
    isConstructorStaticMember: boolean;
};

type ParsedLocalDeclarationMetadataMap = ReadonlyMap<string, ParsedLocalDeclarationMetadata>;
type ConstructorStaticFunctionRange = {
    end: number;
    start: number;
};
type ParsedLocalSourceMetadata = {
    declarations: ParsedLocalDeclarationMetadataMap;
    constructorStaticFunctionRanges: ReadonlyArray<ConstructorStaticFunctionRange>;
};
const REQUIRES_PARSED_LOCAL_CATEGORY_SCAN_PATTERN = /\bstatic\b|\bfor\s*\(\s*var\b/u;

function createDeclarationLookupKey(name: string, start: number): string {
    return `${name}:${start}`;
}

function readNodeStartIndex(node: unknown): number | null {
    if (!Core.isObjectLike(node)) {
        return null;
    }

    const startValue = (node as Record<string, unknown>).start;
    if (typeof startValue === "number") {
        return startValue;
    }

    if (!Core.isObjectLike(startValue)) {
        return null;
    }

    const startRecord = startValue as Record<string, unknown>;
    return typeof startRecord.index === "number" ? startRecord.index : null;
}

function readNodeEndIndex(node: unknown): number | null {
    if (!Core.isObjectLike(node)) {
        return null;
    }

    const endValue = (node as Record<string, unknown>).end;
    if (typeof endValue === "number") {
        return endValue;
    }

    if (!Core.isObjectLike(endValue)) {
        return null;
    }

    const endRecord = endValue as Record<string, unknown>;
    return typeof endRecord.index === "number" ? endRecord.index : null;
}

function classifyVariableDeclarationSyntax(
    node: unknown,
    parent: unknown,
    key: string | number | null
): ParsedLocalNamingCategory | null {
    const declarationKind = Core.getVariableDeclarationKind(node);
    if (declarationKind === "static") {
        return "staticVariable";
    }

    if (
        declarationKind === "var" &&
        Core.isObjectLike(parent) &&
        (parent as Record<string, unknown>).type === "ForStatement" &&
        key === "init"
    ) {
        return "loopIndexVariable";
    }

    return null;
}

function isFunctionLikeNode(node: unknown): boolean {
    return (
        Core.isConstructorDeclarationNode(node) ||
        Core.isFunctionDeclarationNode(node) ||
        Core.isStructFunctionDeclarationNode(node)
    );
}

function extractParsedLocalSourceMetadata(sourceText: string): ParsedLocalSourceMetadata {
    const parsedMetadata = new Map<string, ParsedLocalDeclarationMetadata>();
    const constructorStaticFunctionRanges: Array<ConstructorStaticFunctionRange> = [];
    const ast = Parser.GMLParser.parse(sourceText, {
        getComments: false,
        getLocations: true,
        simplifyLocations: false
    });

    const visitNode = (
        value: unknown,
        insideConstructorScope: boolean,
        parent: unknown,
        key: string | number | null
    ): void => {
        if (Array.isArray(value)) {
            for (let i = 0, len = value.length; i < len; i++) {
                visitNode(value[i], insideConstructorScope, value, i);
            }
            return;
        }

        if (!Core.isObjectLike(value)) {
            return;
        }

        const nextInsideConstructorScope = Core.isConstructorDeclarationNode(value)
            ? true
            : isFunctionLikeNode(value)
              ? false
              : insideConstructorScope;

        const node = value as Record<string, unknown>;

        if (!Core.isVariableDeclarationNode(node)) {
            const keys = Object.keys(node);
            for (let i = 0, len = keys.length; i < len; i++) {
                const childKey = keys[i];
                visitNode(node[childKey], nextInsideConstructorScope, node, childKey);
            }
            return;
        }

        const syntaxCategory = classifyVariableDeclarationSyntax(node, parent, key);
        if (syntaxCategory !== null) {
            for (const declarator of node.declarations ?? []) {
                if (!Core.isVariableDeclaratorNode(declarator)) {
                    continue;
                }

                const declarationName = Core.resolveNodeName(declarator.id ?? null);
                const declarationStart = readNodeStartIndex(declarator.id ?? declarator);
                if (!declarationName || declarationStart === null) {
                    continue;
                }

                parsedMetadata.set(createDeclarationLookupKey(declarationName, declarationStart), {
                    category: syntaxCategory,
                    isConstructorStaticMember: syntaxCategory === "staticVariable" && nextInsideConstructorScope
                });

                if (
                    syntaxCategory === "staticVariable" &&
                    nextInsideConstructorScope &&
                    Core.isFunctionDeclarationNode(declarator.init)
                ) {
                    const functionStart = readNodeStartIndex(declarator.init);
                    const functionEnd = readNodeEndIndex(declarator.init);
                    if (functionStart !== null && functionEnd !== null && functionStart < functionEnd) {
                        constructorStaticFunctionRanges.push({
                            start: functionStart,
                            end: functionEnd
                        });
                    }
                }
            }
        }

        const keys = Object.keys(node);
        for (let i = 0, len = keys.length; i < len; i++) {
            const childKey = keys[i];
            visitNode(node[childKey], nextInsideConstructorScope, node, childKey);
        }
    };

    visitNode(ast, false, null, null);
    return {
        declarations: parsedMetadata,
        constructorStaticFunctionRanges
    };
}

/**
 * Resolves syntax-derived local naming categories for declarations in project files.
 */
export class ParsedLocalNamingCategoryResolver {
    private readonly metadataCache = new Map<string, ParsedLocalSourceMetadata>();
    private readonly projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Resolve a local declaration's refined naming category when syntax provides
     * more precision than the semantic project index alone.
     */
    resolveCategory(
        filePath: string,
        sourceText: string | null,
        name: string,
        start: number
    ): ParsedLocalNamingCategory | null {
        const fileMetadata = this.loadFileMetadata(filePath, sourceText);
        return fileMetadata.declarations.get(createDeclarationLookupKey(name, start))?.category ?? null;
    }

    /**
     * Determine whether a static declaration belongs to constructor scope, which
     * makes dotted member accesses a valid external reference form.
     */
    isConstructorStaticMember(filePath: string, sourceText: string | null, name: string, start: number): boolean {
        const fileMetadata = this.loadFileMetadata(filePath, sourceText);
        return (
            fileMetadata.declarations.get(createDeclarationLookupKey(name, start))?.isConstructorStaticMember === true
        );
    }

    /**
     * Return source ranges for constructor static function expressions in a file.
     */
    listConstructorStaticFunctionRanges(
        filePath: string,
        sourceText: string | null
    ): ReadonlyArray<ConstructorStaticFunctionRange> {
        return this.loadFileMetadata(filePath, sourceText).constructorStaticFunctionRanges;
    }

    /**
     * Clear cached per-file declaration metadata after the underlying project
     * sources change.
     */
    clear(): void {
        this.metadataCache.clear();
    }

    private loadFileMetadata(filePath: string, sourceText: string | null): ParsedLocalSourceMetadata {
        const cachedMetadata = this.metadataCache.get(filePath);
        if (cachedMetadata) {
            return cachedMetadata;
        }

        let parsedMetadata: ParsedLocalSourceMetadata = {
            declarations: new Map(),
            constructorStaticFunctionRanges: []
        };

        try {
            let resolvedSourceText = sourceText;
            if (resolvedSourceText === null) {
                const absoluteFilePath = path.resolve(this.projectRoot, filePath);
                if (pathExistsSync(absoluteFilePath)) {
                    resolvedSourceText = fs.readFileSync(absoluteFilePath, "utf8");
                }
            }

            if (resolvedSourceText !== null && REQUIRES_PARSED_LOCAL_CATEGORY_SCAN_PATTERN.test(resolvedSourceText)) {
                parsedMetadata = extractParsedLocalSourceMetadata(resolvedSourceText);
            }
        } catch {
            parsedMetadata = {
                declarations: new Map(),
                constructorStaticFunctionRanges: []
            };
        }

        this.metadataCache.set(filePath, parsedMetadata);
        return parsedMetadata;
    }
}
