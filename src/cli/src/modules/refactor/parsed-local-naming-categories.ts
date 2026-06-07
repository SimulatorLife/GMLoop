import * as fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

type ParsedLocalNamingCategory = "staticVariable" | "loopIndexVariable";

type ParsedLocalDeclarationMetadata = {
    category: ParsedLocalNamingCategory;
    isConstructorStaticMember: boolean;
};

type ParsedLocalDeclarationMetadataMap = ReadonlyMap<string, ParsedLocalDeclarationMetadata>;
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

function extractParsedLocalDeclarationMetadata(sourceText: string): ParsedLocalDeclarationMetadataMap {
    const parsedMetadata = new Map<string, ParsedLocalDeclarationMetadata>();
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
            for (const [entryIndex, entry] of value.entries()) {
                visitNode(entry, insideConstructorScope, value, entryIndex);
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
            for (const [childKey, child] of Object.entries(node)) {
                visitNode(child, nextInsideConstructorScope, node, childKey);
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
            }
        }

        for (const [childKey, child] of Object.entries(node)) {
            visitNode(child, nextInsideConstructorScope, node, childKey);
        }
    };

    visitNode(ast, false, null, null);
    return parsedMetadata;
}

/**
 * Resolves syntax-derived local naming categories for declarations in project files.
 */
export class ParsedLocalNamingCategoryResolver {
    private readonly categoryCache = new Map<string, ParsedLocalDeclarationMetadataMap>();
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
        const fileCategories = this.loadFileCategories(filePath, sourceText);
        return fileCategories.get(createDeclarationLookupKey(name, start))?.category ?? null;
    }

    /**
     * Determine whether a static declaration belongs to constructor scope, which
     * makes dotted member accesses a valid external reference form.
     */
    isConstructorStaticMember(filePath: string, sourceText: string | null, name: string, start: number): boolean {
        const fileCategories = this.loadFileCategories(filePath, sourceText);
        return fileCategories.get(createDeclarationLookupKey(name, start))?.isConstructorStaticMember === true;
    }

    /**
     * Clear cached per-file declaration metadata after the underlying project
     * sources change.
     */
    clear(): void {
        this.categoryCache.clear();
    }

    private loadFileCategories(filePath: string, sourceText: string | null): ParsedLocalDeclarationMetadataMap {
        const cachedCategories = this.categoryCache.get(filePath);
        if (cachedCategories) {
            return cachedCategories;
        }

        let parsedCategories: ParsedLocalDeclarationMetadataMap = new Map();

        try {
            let resolvedSourceText = sourceText;
            if (resolvedSourceText === null) {
                const absoluteFilePath = path.resolve(this.projectRoot, filePath);
                if (fs.existsSync(absoluteFilePath)) {
                    resolvedSourceText = fs.readFileSync(absoluteFilePath, "utf8");
                }
            }

            if (resolvedSourceText !== null && REQUIRES_PARSED_LOCAL_CATEGORY_SCAN_PATTERN.test(resolvedSourceText)) {
                parsedCategories = extractParsedLocalDeclarationMetadata(resolvedSourceText);
            }
        } catch {
            parsedCategories = new Map();
        }

        this.categoryCache.set(filePath, parsedCategories);
        return parsedCategories;
    }
}
