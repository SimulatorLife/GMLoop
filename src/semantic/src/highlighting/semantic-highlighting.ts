import { Parser } from "@gmloop/parser";

import {
    getGmlSymbolKindForBuiltInType,
    getGmlSymbolKindSpecificity,
    type GmlSemanticSymbolKind,
    normalizeGmlSemanticSymbolKind
} from "../symbols/taxonomy.js";

/** Semantic categories exposed to editor protocol adapters. */
export type GmlSemanticHighlightKind =
    | "class"
    | "enum"
    | "enumMember"
    | "function"
    | "macro"
    | "method"
    | "namespace"
    | "parameter"
    | "property"
    | "variable";

/** Semantic modifiers that describe an identifier occurrence. */
export type GmlSemanticHighlightModifier =
    | "declaration"
    | "defaultLibrary"
    | "definition"
    | "deprecated"
    | "readonly"
    | "static";

/** A source-relative semantic highlight range using UTF-16 offsets. */
export type GmlSemanticHighlightToken = Readonly<{
    end: number;
    kind: GmlSemanticHighlightKind;
    modifiers: ReadonlyArray<GmlSemanticHighlightModifier>;
    start: number;
}>;

/** Project occurrence facts consumed by semantic highlighting. */
export type GmlSemanticHighlightOccurrence = Readonly<{
    end: number;
    kind: GmlSemanticSymbolKind;
    role: "definition" | "reference";
    start: number;
}>;

/** Bundled GameMaker identifier facts consumed by semantic highlighting. */
export type GmlBuiltInHighlightIdentifier = Readonly<{
    deprecated: boolean;
    name: string;
    type: string;
}>;

export type CollectGmlSemanticHighlightsParameters = Readonly<{
    builtIns: ReadonlyArray<GmlBuiltInHighlightIdentifier>;
    occurrences: ReadonlyArray<GmlSemanticHighlightOccurrence>;
    projectIdentifiers: ReadonlyArray<Readonly<{ kind: GmlSemanticSymbolKind; name: string }>>;
    sourceText: string;
}>;

type IdentifierRange = ReturnType<typeof Parser.tokenizeGmlIdentifierRanges>[number];

function mapNavigationKind(kind: GmlSemanticSymbolKind): GmlSemanticHighlightKind | null {
    const kinds: Readonly<Record<string, GmlSemanticHighlightKind>> = {
        callable: "function",
        constant: "variable",
        constructorStaticMember: "method",
        enum: "enum",
        enumMember: "enumMember",
        function: "function",
        globalVariable: "variable",
        instanceVariable: "property",
        localVariable: "variable",
        macro: "macro",
        member: "property",
        object: "class",
        parameter: "parameter",
        room: "namespace",
        resource: "namespace",
        script: "function",
        struct: "class",
        structVariable: "property",
        variable: "variable"
    };
    return kinds[kind] ?? null;
}

function isKeywordAt(text: string, index: number, keyword: string): boolean {
    if (text.slice(index, index + keyword.length) !== keyword) return false;
    const prevChar = index > 0 ? text.charAt(index - 1) : "";
    const nextChar = index + keyword.length < text.length ? text.charAt(index + keyword.length) : "";
    const wordCharRegex = /[$_\p{L}\p{Mn}\p{Nd}\p{Pc}]/u;
    if (prevChar !== "" && wordCharRegex.test(prevChar)) return false;
    if (nextChar !== "" && wordCharRegex.test(nextChar)) return false;
    return true;
}

function isInsideDeclarationBlock(before: string, kind: "parameter" | "enumMember"): boolean {
    const keyword = kind === "parameter" ? "function" : "enum";
    const openChar = kind === "parameter" ? "(" : "{";

    const indices: number[] = [];
    for (let i = 0; i <= before.length - keyword.length; i++) {
        if (isKeywordAt(before, i, keyword)) {
            indices.push(i);
        }
    }
    if (indices.length === 0) return false;

    for (let idx = indices.length - 1; idx >= 0; idx--) {
        const startIdx = indices[idx];
        if (startIdx === undefined) continue;

        let insideBody = false;
        let parenNesting = 0;
        let braceNesting = 0;
        let bracketNesting = 0;
        let inDefaultValue = false;
        let lastTokenChar = "";
        let isClosed = false;

        let inComment: "single" | "multi" | null = null;
        let inString: string | null = null;

        for (let i = startIdx + keyword.length; i < before.length; i++) {
            const char = before.charAt(i);
            const nextChar = before.charAt(i + 1);

            if (inComment === "single") {
                if (char === "\n" || char === "\r") inComment = null;
                continue;
            }
            if (inComment === "multi") {
                if (char === "*" && nextChar === "/") {
                    inComment = null;
                    i++;
                }
                continue;
            }
            if (inString !== null) {
                if (char === "\\" && (inString === "'" || inString === '"')) {
                    i++;
                } else if (char === inString) {
                    inString = null;
                }
                continue;
            }

            if (char === "/" && nextChar === "/") {
                inComment = "single";
                i++;
                continue;
            }
            if (char === "/" && nextChar === "*") {
                inComment = "multi";
                i++;
                continue;
            }
            if (char === "'" || char === '"') {
                inString = char;
                continue;
            }

            if (!insideBody) {
                if (char === openChar) {
                    insideBody = true;
                    parenNesting = kind === "parameter" ? 1 : 0;
                    braceNesting = kind === "enumMember" ? 1 : 0;
                    lastTokenChar = openChar;
                } else if (!/\s/u.test(char) && !/[$_\p{L}\p{Mn}\p{Nd}\p{Pc}]/u.test(char)) {
                    break;
                }
                continue;
            }

            if (char === "(") {
                parenNesting++;
                lastTokenChar = "(";
            } else if (char === ")") {
                parenNesting--;
                lastTokenChar = ")";
                if (kind === "parameter" && parenNesting === 0) {
                    isClosed = true;
                    break;
                }
            } else if (char === "{") {
                braceNesting++;
                lastTokenChar = "{";
            } else if (char === "}") {
                braceNesting--;
                lastTokenChar = "}";
                if (kind === "enumMember" && braceNesting === 0) {
                    isClosed = true;
                    break;
                }
            } else if (char === "[") {
                bracketNesting++;
                lastTokenChar = "[";
            } else if (char === "]") {
                bracketNesting--;
                lastTokenChar = "]";
            } else if (char === "=") {
                const targetParen = kind === "parameter" ? 1 : 0;
                const targetBrace = kind === "enumMember" ? 1 : 0;
                if (parenNesting === targetParen && braceNesting === targetBrace && bracketNesting === 0) {
                    inDefaultValue = true;
                }
                lastTokenChar = "=";
            } else if (char === ",") {
                const targetParen = kind === "parameter" ? 1 : 0;
                const targetBrace = kind === "enumMember" ? 1 : 0;
                if (parenNesting === targetParen && braceNesting === targetBrace && bracketNesting === 0) {
                    inDefaultValue = false;
                }
                lastTokenChar = ",";
            } else if (/\s/u.test(char)) {
                // Skip whitespace
            } else {
                lastTokenChar = char;
            }
        }

        if (!insideBody || isClosed) {
            continue;
        }

        const targetParen = kind === "parameter" ? 1 : 0;
        const targetBrace = kind === "enumMember" ? 1 : 0;

        return (
            parenNesting === targetParen &&
            braceNesting === targetBrace &&
            bracketNesting === 0 &&
            !inDefaultValue &&
            (lastTokenChar === openChar || lastTokenChar === ",")
        );
    }

    return false;
}

function classifyDeclaration(sourceText: string, identifier: IdentifierRange): GmlSemanticHighlightToken | null {
    const before = sourceText.slice(Math.max(0, identifier.start - 120), identifier.start);
    const after = sourceText.slice(identifier.end, identifier.end + 80);
    const definition: GmlSemanticHighlightModifier[] = ["declaration", "definition"];
    if (/(?:#macro)\s*$/u.test(before)) return { ...identifier, kind: "macro", modifiers: [...definition, "readonly"] };
    if (/\benum\s*$/u.test(before)) return { ...identifier, kind: "enum", modifiers: definition };
    if (/\bfunction\s*$/u.test(before)) {
        return { ...identifier, kind: /\)\s*constructor\b/u.test(after) ? "class" : "function", modifiers: definition };
    }
    if (/\b(?:var|globalvar)\s+(?:[$_\p{L}][$_\p{L}\p{Mn}\p{Nd}\p{Pc}]*\s*,\s*)*$/u.test(before)) {
        return { ...identifier, kind: "variable", modifiers: definition };
    }
    if (/\bstatic\s*$/u.test(before)) return { ...identifier, kind: "property", modifiers: [...definition, "static"] };
    if (isInsideDeclarationBlock(before, "parameter")) {
        return { ...identifier, kind: "parameter", modifiers: definition };
    }
    if (isInsideDeclarationBlock(before, "enumMember")) {
        return { ...identifier, kind: "enumMember", modifiers: [...definition, "readonly"] };
    }
    if (/\.\s*$/u.test(before)) {
        return { ...identifier, kind: /^\s*\(/u.test(after) ? "method" : "property", modifiers: [] };
    }
    return null;
}

/** Collect stable, ordered semantic identifier facts for an open GML document. */
export function collectGmlSemanticHighlights(
    parameters: CollectGmlSemanticHighlightsParameters
): GmlSemanticHighlightToken[] {
    const tokensByStart = new Map<number, GmlSemanticHighlightToken>();
    const identifiers = Parser.tokenizeGmlIdentifierRanges(parameters.sourceText);
    const identifiersByStart = new Map(identifiers.map((identifier) => [identifier.start, identifier]));
    const lexicalKindByName = new Map<string, GmlSemanticHighlightKind>();
    const navigationKindPriorityByStart = new Map<number, number>();
    for (const identifier of identifiers) {
        const declaration = classifyDeclaration(parameters.sourceText, identifier);
        if (declaration !== null) {
            tokensByStart.set(identifier.start, declaration);
            if (
                declaration.kind === "enumMember" ||
                declaration.kind === "macro" ||
                declaration.kind === "parameter" ||
                declaration.kind === "variable"
            ) {
                lexicalKindByName.set(identifier.name, declaration.kind);
            }
        }
    }
    for (const occurrence of parameters.occurrences) {
        if (!identifiersByStart.has(occurrence.start)) continue;
        const priority = getGmlSymbolKindSpecificity(occurrence.kind);
        if (priority < (navigationKindPriorityByStart.get(occurrence.start) ?? 0)) continue;
        navigationKindPriorityByStart.set(occurrence.start, priority);
        const highlightKind = mapNavigationKind(occurrence.kind);
        if (highlightKind === null) continue;
        tokensByStart.set(occurrence.start, {
            start: occurrence.start,
            end: occurrence.end,
            kind: highlightKind,
            modifiers: [
                ...(occurrence.role === "definition" ? (["declaration", "definition"] as const) : []),
                ...(occurrence.kind === "constructorStaticMember" ? (["static"] as const) : [])
            ]
        });
    }
    const projectIdentifiers = new Map(parameters.projectIdentifiers.map((entry) => [entry.name, entry.kind]));
    for (const identifier of identifiers) {
        if (tokensByStart.has(identifier.start)) continue;
        const projectKind = projectIdentifiers.get(identifier.name);
        if (projectKind === undefined) continue;
        const highlightKind = mapNavigationKind(normalizeGmlSemanticSymbolKind(projectKind));
        if (highlightKind === null) continue;
        tokensByStart.set(identifier.start, { ...identifier, kind: highlightKind, modifiers: [] });
    }
    for (const identifier of identifiers) {
        if (tokensByStart.has(identifier.start)) continue;
        const lexicalKind = lexicalKindByName.get(identifier.name);
        if (lexicalKind === undefined) continue;
        tokensByStart.set(identifier.start, { ...identifier, kind: lexicalKind, modifiers: [] });
    }
    const builtIns = new Map(parameters.builtIns.map((entry) => [entry.name, entry]));
    for (const identifier of identifiers) {
        if (tokensByStart.has(identifier.start)) continue;
        const builtIn = builtIns.get(identifier.name);
        if (builtIn === undefined) continue;
        const semanticKind = getGmlSymbolKindForBuiltInType(builtIn.type);
        if (semanticKind === null) continue;
        const kind = mapNavigationKind(semanticKind);
        if (kind === null) continue;
        const modifiers: GmlSemanticHighlightModifier[] = ["defaultLibrary"];
        if (builtIn.type !== "function") modifiers.push("readonly");
        if (builtIn.deprecated) modifiers.push("deprecated");
        tokensByStart.set(identifier.start, { ...identifier, kind, modifiers });
    }
    return [...tokensByStart.values()].sort((left, right) => left.start - right.start || left.end - right.end);
}
