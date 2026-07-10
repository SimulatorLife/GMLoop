import { Parser } from "@gmloop/parser";

import {
    getGmlSymbolKindForBuiltInType,
    getGmlSymbolKindSpecificity,
    type GmlSemanticSymbolKind,
    normalizeGmlSemanticSymbolKind} from "../symbols/taxonomy.js";

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
        room: "namespace",
        resource: "namespace",
        script: "function",
        struct: "class",
        structVariable: "property",
        variable: "variable"
    };
    return kinds[kind] ?? null;
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
    if (/\bfunction(?:\s+[$_\p{L}][$_\p{L}\p{Mn}\p{Nd}\p{Pc}]*)?\s*\([^)]*$/u.test(before)) {
        return { ...identifier, kind: "parameter", modifiers: definition };
    }
    if (/\benum\s+[$_\p{L}][$_\p{L}\p{Mn}\p{Nd}\p{Pc}]*\s*\{[^}]*$/u.test(before)) {
        return { ...identifier, kind: "enumMember", modifiers: [...definition, "readonly"] };
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
    const navigationKindPriorityByStart = new Map<number, number>();
    for (const identifier of identifiers) {
        const declaration = classifyDeclaration(parameters.sourceText, identifier);
        if (declaration !== null) {
            tokensByStart.set(identifier.start, declaration);
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
