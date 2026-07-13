/** Canonical semantic identity categories shared by all semantic consumers. */
export type GmlSemanticSymbolKind =
    | "callable"
    | "constant"
    | "constructorStaticMember"
    | "enum"
    | "enumMember"
    | "function"
    | "globalVariable"
    | "instanceVariable"
    | "localVariable"
    | "macro"
    | "member"
    | "object"
    | "parameter"
    | "resource"
    | "room"
    | "script"
    | "struct"
    | "structVariable"
    | "unresolved"
    | "variable";

/** Project-index identifier collections with canonical semantic ownership. */
export type GmlIdentifierCollectionName =
    | "constructorStaticMembers"
    | "enumMembers"
    | "enums"
    | "functions"
    | "globalVariables"
    | "instanceVariables"
    | "localVariables"
    | "macros"
    | "scripts"
    | "structVariables"
    | "structs";

/** Identifier categories emitted by the bundled GameMaker manual metadata. */
export type GmlBuiltInIdentifierType =
    | "accessor"
    | "constant"
    | "enum"
    | "event"
    | "function"
    | "keyword"
    | "literal"
    | "property"
    | "symbol"
    | "unknown"
    | "variable";

const SYMBOL_KIND_BY_IDENTIFIER_COLLECTION: Readonly<Record<GmlIdentifierCollectionName, GmlSemanticSymbolKind>> =
    Object.freeze({
        constructorStaticMembers: "constructorStaticMember",
        enumMembers: "enumMember",
        enums: "enum",
        functions: "function",
        globalVariables: "globalVariable",
        instanceVariables: "instanceVariable",
        localVariables: "localVariable",
        macros: "macro",
        scripts: "script",
        structVariables: "structVariable",
        structs: "struct"
    });

/** Resolve a project-index collection to its canonical semantic kind. */
export function getGmlSymbolKindForIdentifierCollection(collectionName: string): GmlSemanticSymbolKind {
    return Object.hasOwn(SYMBOL_KIND_BY_IDENTIFIER_COLLECTION, collectionName)
        ? SYMBOL_KIND_BY_IDENTIFIER_COLLECTION[collectionName as GmlIdentifierCollectionName]
        : "unresolved";
}

/** Specificity used when multiple semantic facts describe the same source token. */
export function getGmlSymbolKindSpecificity(kind: GmlSemanticSymbolKind): number {
    if (kind === "constructorStaticMember") return 3;
    if (kind === "instanceVariable" || kind === "structVariable") return 2;
    return kind === "unresolved" ? 0 : 1;
}

/** Narrow arbitrary external metadata to a canonical semantic kind. */
export function isGmlSemanticSymbolKind(value: string): value is GmlSemanticSymbolKind {
    return (
        value === "callable" ||
        value === "constant" ||
        value === "constructorStaticMember" ||
        value === "enum" ||
        value === "enumMember" ||
        value === "function" ||
        value === "globalVariable" ||
        value === "instanceVariable" ||
        value === "localVariable" ||
        value === "macro" ||
        value === "member" ||
        value === "object" ||
        value === "parameter" ||
        value === "resource" ||
        value === "room" ||
        value === "script" ||
        value === "struct" ||
        value === "structVariable" ||
        value === "unresolved" ||
        value === "variable"
    );
}

/** Normalize external kind strings without inventing a fallback identity. */
export function normalizeGmlSemanticSymbolKind(value: string): GmlSemanticSymbolKind {
    return isGmlSemanticSymbolKind(value) ? value : "unresolved";
}

/** Convert bundled manual metadata types into semantic identity without editor policy. */
export function getGmlSymbolKindForBuiltInType(type: string): GmlSemanticSymbolKind | null {
    if (type === "accessor" || type === "keyword") return null;
    if (type === "function") return "function";
    if (type === "enum") return "enum";
    if (type === "property") return "member";
    if (type === "constant" || type === "event" || type === "literal" || type === "symbol") return "constant";
    return "variable";
}
