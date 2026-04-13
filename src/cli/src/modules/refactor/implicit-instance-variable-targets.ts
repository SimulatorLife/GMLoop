import * as fs from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

type SemanticFileRecord = {
    references?: Array<Record<string, unknown>>;
};

type SymbolOccurrence = {
    end: number;
    kind?: "definition" | "reference";
    path: string;
    scopeId?: string;
    start: number;
};

type BridgeNamingConventionTarget = {
    category: "instanceVariable";
    name: string;
    occurrences: Array<SymbolOccurrence>;
    path: string;
    scopeId: string | null;
    symbolId: null;
};

type ImplicitInstanceVariableCollectorParameters = {
    files: Record<string, SemanticFileRecord>;
    knownEnumNames: Set<string>;
    knownNamesByObjectDirectory: Map<string, Set<string>>;
    knownResourceNames: Set<string>;
    projectRoot: string;
    shouldIncludePath: (candidatePath: string | null | undefined) => boolean;
};

type CandidateOccurrence = SymbolOccurrence & {
    isDefinitionLike: boolean;
};

function getObjectDirectory(filePath: string): string {
    return path.posix.dirname(filePath.replaceAll("\\", "/"));
}

function isObjectEventFilePath(filePath: string): boolean {
    const normalizedPath = filePath.replaceAll("\\", "/");
    const segments = normalizedPath.split("/");
    if (segments.length < 3 || segments[0] !== "objects") {
        return false;
    }

    const objectName = segments[1];
    const fileName = segments.at(-1);
    return Core.isNonEmptyString(objectName) && Core.isNonEmptyString(fileName) && fileName.endsWith(".gml");
}

function isObjectScopeId(scopeId: unknown): boolean {
    return typeof scopeId === "string" && (scopeId.startsWith("scope:object:") || /^scope-\d+$/u.test(scopeId));
}

function readProjectFile(projectRoot: string, filePath: string, cache: Map<string, string>): string | null {
    const cached = cache.get(filePath);
    if (cached !== undefined) {
        return cached;
    }

    try {
        const absoluteFilePath = path.resolve(projectRoot, filePath);
        const content = fs.readFileSync(absoluteFilePath, "utf8");
        cache.set(filePath, content);
        return content;
    } catch {
        return null;
    }
}

function findLineEndIndex(source: string, startIndex: number): number {
    const newlineIndex = source.indexOf("\n", startIndex);
    return newlineIndex === -1 ? source.length : newlineIndex;
}

function matchesIndexedAssignmentTail(tail: string): boolean {
    return /^(?:\s*(?:\[[^\]\n]*\]|\.[A-Za-z_][A-Za-z0-9_]*))*\s*(?:<<=|>>=|\+=|-=|\*=|\/=|%=|\^=|&=|\|=|=)(?![=])/.test(
        tail
    );
}

function isDefinitionLikeReference(source: string, start: number, end: number): boolean {
    if (start < 0 || end <= start || end > source.length) {
        return false;
    }

    const lineEndIndex = findLineEndIndex(source, end);
    const tail = source.slice(end, lineEndIndex);
    return matchesIndexedAssignmentTail(tail);
}

function readDottedReferenceOwnerName(source: string, startIndex: number): string | null {
    if (startIndex <= 0 || startIndex > source.length) {
        return null;
    }

    let cursor = startIndex - 1;
    while (cursor >= 0 && /\s/u.test(source[cursor] ?? "")) {
        cursor -= 1;
    }

    if (cursor < 0 || source[cursor] !== ".") {
        return null;
    }

    cursor -= 1;
    while (cursor >= 0 && /\s/u.test(source[cursor] ?? "")) {
        cursor -= 1;
    }

    const ownerEnd = cursor + 1;
    while (cursor >= 0 && /[A-Za-z0-9_]/u.test(source[cursor] ?? "")) {
        cursor -= 1;
    }

    const ownerName = source.slice(cursor + 1, ownerEnd);
    return ownerName.length > 0 ? ownerName : null;
}

function isKnownEnumMemberPropertyReference(
    reference: Record<string, unknown>,
    source: string,
    startIndex: number,
    knownEnumNames: ReadonlySet<string>
): boolean {
    const classifications = Core.asArray(reference.classifications);
    if (
        !classifications.includes("property") &&
        !classifications.includes("member") &&
        !classifications.includes("enum-member")
    ) {
        return false;
    }

    const ownerName = readDottedReferenceOwnerName(source, startIndex);
    return ownerName !== null && knownEnumNames.has(ownerName);
}

function buildCandidateOccurrence(
    filePath: string,
    reference: Record<string, unknown>,
    source: string
): CandidateOccurrence | null {
    const referenceName = typeof reference.name === "string" ? reference.name : null;
    const declaration = Core.isObjectLike(reference.declaration)
        ? (reference.declaration as Record<string, unknown>)
        : null;
    const isBuiltIn = reference.isBuiltIn === true;
    const isGlobalIdentifier = reference.isGlobalIdentifier === true;

    if (!Core.isNonEmptyString(referenceName) || declaration !== null || isBuiltIn || isGlobalIdentifier) {
        return null;
    }

    const startRecord = Core.isObjectLike(reference.start) ? (reference.start as Record<string, unknown>) : null;
    const endRecord = Core.isObjectLike(reference.end) ? (reference.end as Record<string, unknown>) : null;
    const start = typeof startRecord?.index === "number" ? startRecord.index : -1;
    const endInclusive = typeof endRecord?.index === "number" ? endRecord.index : -1;
    // Project-index identifier spans use inclusive end positions. Convert them
    // to the exclusive form expected by refactor text ranges and string slicing.
    const end = endInclusive >= start ? endInclusive + 1 : -1;

    if (start < 0 || end <= start || source.slice(start, end) !== referenceName) {
        return null;
    }

    const isDefinitionLike = isDefinitionLikeReference(source, start, end);

    return {
        path: filePath,
        start,
        end,
        scopeId: typeof reference.scopeId === "string" ? reference.scopeId : undefined,
        kind: isDefinitionLike ? "definition" : "reference",
        isDefinitionLike
    };
}

function deduplicateCandidateOccurrences(occurrences: Array<CandidateOccurrence>): Array<CandidateOccurrence> {
    const occurrencesByKey = new Map<string, CandidateOccurrence>();

    for (const occurrence of occurrences) {
        const key = `${occurrence.path}:${occurrence.start}:${occurrence.end}`;
        if (!occurrencesByKey.has(key)) {
            occurrencesByKey.set(key, occurrence);
        }
    }

    return [...occurrencesByKey.values()].sort((left, right) => left.start - right.start);
}

function isKnownProjectResourceName(referenceName: string, knownResourceNames: ReadonlySet<string>): boolean {
    return knownResourceNames.has(referenceName.toLowerCase());
}

/**
 * Collect unresolved assignment-backed object fields as implicit instance-variable naming targets.
 */
export function collectImplicitInstanceVariableTargets(
    parameters: ImplicitInstanceVariableCollectorParameters
): Array<BridgeNamingConventionTarget> {
    const sourceCache = new Map<string, string>();
    const candidatesByName = new Map<string, Array<CandidateOccurrence>>();

    for (const [filePath, fileRecord] of Object.entries(parameters.files)) {
        if (!parameters.shouldIncludePath(filePath) || !isObjectEventFilePath(filePath)) {
            continue;
        }

        const source = readProjectFile(parameters.projectRoot, filePath, sourceCache);
        if (source === null) {
            continue;
        }

        const objectDirectory = getObjectDirectory(filePath);
        const knownNames = parameters.knownNamesByObjectDirectory.get(objectDirectory) ?? new Set<string>();

        for (const reference of fileRecord.references ?? []) {
            if (!isObjectScopeId(reference.scopeId)) {
                continue;
            }

            const candidate = buildCandidateOccurrence(filePath, reference, source);
            if (candidate === null) {
                continue;
            }

            if (isKnownEnumMemberPropertyReference(reference, source, candidate.start, parameters.knownEnumNames)) {
                continue;
            }

            const referenceName = source.slice(candidate.start, candidate.end);
            if (isKnownProjectResourceName(referenceName, parameters.knownResourceNames)) {
                continue;
            }

            if (knownNames.has(referenceName)) {
                continue;
            }

            const group = candidatesByName.get(referenceName) ?? [];
            group.push(candidate);
            candidatesByName.set(referenceName, group);
        }
    }

    const targets: Array<BridgeNamingConventionTarget> = [];

    for (const [name, occurrences] of candidatesByName.entries()) {
        const deduplicatedOccurrences = deduplicateCandidateOccurrences(occurrences);
        const definitionOccurrence = deduplicatedOccurrences.find((occurrence) => occurrence.isDefinitionLike);
        if (!definitionOccurrence) {
            continue;
        }

        const objectDirectory = getObjectDirectory(definitionOccurrence.path);

        targets.push({
            category: "instanceVariable",
            name,
            occurrences: deduplicatedOccurrences.map(
                ({ isDefinitionLike: _isDefinitionLike, ...occurrence }) => occurrence
            ),
            path: definitionOccurrence.path,
            scopeId: objectDirectory,
            symbolId: null
        });
    }

    return targets.sort((left, right) => left.path.localeCompare(right.path) || left.name.localeCompare(right.name));
}
