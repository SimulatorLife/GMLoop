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
    kind: string;
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
    projectIdentifiers: ReadonlyArray<Readonly<{ kind: string; name: string }>>;
    sourceText: string;
}>;

type IdentifierRange = Readonly<{ end: number; name: string; start: number }>;

const IDENTIFIER_PATTERN = /[$_\p{L}][$_\p{L}\p{Mn}\p{Nd}\p{Pc}]*/uy;

function scanIdentifiers(sourceText: string): IdentifierRange[] {
    const identifiers: IdentifierRange[] = [];
    let offset = 0;
    while (offset < sourceText.length) {
        if (sourceText.startsWith("//", offset)) {
            const lineEnd = sourceText.indexOf("\n", offset + 2);
            offset = lineEnd === -1 ? sourceText.length : lineEnd;
            continue;
        }
        if (sourceText.startsWith("/*", offset)) {
            const commentEnd = sourceText.indexOf("*/", offset + 2);
            offset = commentEnd === -1 ? sourceText.length : commentEnd + 2;
            continue;
        }
        const character = sourceText[offset];
        const isStringStart =
            character === '"' ||
            character === "'" ||
            ((character === "$" || character === "@") &&
                (sourceText[offset + 1] === '"' || sourceText[offset + 1] === "'"));
        if (isStringStart) {
            const quoteOffset = character === '"' || character === "'" ? offset : offset + 1;
            const quote = sourceText[quoteOffset];
            const verbatim = character === "@";
            offset = quoteOffset + 1;
            while (offset < sourceText.length) {
                if (sourceText[offset] === quote) {
                    if (verbatim && sourceText[offset + 1] === quote) {
                        offset += 2;
                        continue;
                    }
                    offset += 1;
                    break;
                }
                offset += !verbatim && sourceText[offset] === "\\" ? 2 : 1;
            }
            continue;
        }
        IDENTIFIER_PATTERN.lastIndex = offset;
        const match = IDENTIFIER_PATTERN.exec(sourceText);
        if (match !== null) {
            identifiers.push({ start: offset, end: IDENTIFIER_PATTERN.lastIndex, name: match[0] });
            offset = IDENTIFIER_PATTERN.lastIndex;
            continue;
        }
        offset += 1;
    }
    return identifiers;
}

function mapNavigationKind(kind: string): GmlSemanticHighlightKind {
    const kinds: Readonly<Record<string, GmlSemanticHighlightKind>> = {
        callable: "function",
        constructorStaticMember: "property",
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
        script: "function",
        struct: "class",
        structVariable: "property",
        variable: "variable"
    };
    return kinds[kind] ?? "namespace";
}

function mapBuiltInKind(type: string): GmlSemanticHighlightKind | null {
    if (type === "accessor" || type === "keyword") return null;
    if (type === "function") return "function";
    if (type === "enum") return "enum";
    if (type === "property") return "property";
    return "variable";
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
    const identifiers = scanIdentifiers(parameters.sourceText);
    const identifiersByStart = new Map(identifiers.map((identifier) => [identifier.start, identifier]));
    for (const identifier of identifiers) {
        const declaration = classifyDeclaration(parameters.sourceText, identifier);
        if (declaration !== null) {
            tokensByStart.set(identifier.start, declaration);
        }
    }
    for (const occurrence of parameters.occurrences) {
        if (!identifiersByStart.has(occurrence.start)) continue;
        tokensByStart.set(occurrence.start, {
            start: occurrence.start,
            end: occurrence.end,
            kind: mapNavigationKind(occurrence.kind),
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
        tokensByStart.set(identifier.start, { ...identifier, kind: mapNavigationKind(projectKind), modifiers: [] });
    }
    const builtIns = new Map(parameters.builtIns.map((entry) => [entry.name, entry]));
    for (const identifier of identifiers) {
        if (tokensByStart.has(identifier.start)) continue;
        const builtIn = builtIns.get(identifier.name);
        if (builtIn === undefined) continue;
        const kind = mapBuiltInKind(builtIn.type);
        if (kind === null) continue;
        const modifiers: GmlSemanticHighlightModifier[] = ["defaultLibrary"];
        if (builtIn.type !== "function") modifiers.push("readonly");
        if (builtIn.deprecated) modifiers.push("deprecated");
        tokensByStart.set(identifier.start, { ...identifier, kind, modifiers });
    }
    return [...tokensByStart.values()].sort((left, right) => left.start - right.start || left.end - right.end);
}
