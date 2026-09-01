import type { SemanticOccurrenceResolution, SemanticUncertainResolution } from "./semantic-snapshot.js";
import {
    createEmptyGmlSymbolDocumentation,
    type GmlSymbolDocumentation,
    parseGmlSymbolDocumentation
} from "./symbol-documentation.js";

type SemanticJsonValue =
    | boolean
    | number
    | string
    | null
    | ReadonlyArray<SemanticJsonValue>
    | Readonly<{ [key: string]: SemanticJsonValue }>;

type SemanticScalarValue = boolean | number | string | null;

function isSemanticScalarValue(value: SemanticJsonValue): value is SemanticScalarValue {
    return value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string";
}

function parseSemanticJsonValue(payload: string): SemanticJsonValue | null {
    try {
        return JSON.parse(payload) as SemanticJsonValue;
    } catch {
        return null;
    }
}

/** Decode a persisted JSON object emitted by the canonical semantic store. */
export function parseSemanticRecordPayload(payload: string): Readonly<Record<string, SemanticJsonValue>> | null {
    const parsed = parseSemanticJsonValue(payload);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Readonly<Record<string, SemanticJsonValue>>)
        : null;
}

/** Decode only the scalar fields of a persisted semantic relationship payload. */
export function parseSemanticScalarRecordPayload(
    payload: string
): Readonly<Record<string, SemanticScalarValue>> | null {
    const record = parseSemanticRecordPayload(payload);
    if (record === null) {
        return null;
    }
    const values: Array<readonly [string, SemanticScalarValue]> = [];
    for (const [key, value] of Object.entries(record)) {
        if (isSemanticScalarValue(value)) {
            values.push([key, value]);
        }
    }
    return Object.freeze(Object.fromEntries(values));
}

/** Decode canonical structured symbol documentation from persistent storage. */
export function parsePersistedSemanticDocumentation(value: string): GmlSymbolDocumentation {
    const record = parseSemanticRecordPayload(value);
    return record !== null && typeof record.normalizedText === "string"
        ? parseGmlSymbolDocumentation(record.normalizedText)
        : createEmptyGmlSymbolDocumentation();
}

/** Decode the certainty attached to one persisted semantic occurrence. */
export function parsePersistedOccurrenceResolution(value: string): SemanticOccurrenceResolution | null {
    const record = parseSemanticRecordPayload(value);
    if (record === null) {
        return null;
    }
    if (record.kind === "exact") {
        return Object.freeze({ kind: "exact" });
    }
    const uncertaintyReason = typeof record.uncertaintyReason === "string" ? record.uncertaintyReason : null;
    if (uncertaintyReason === null) {
        return null;
    }
    if (record.kind === "dynamic" || record.kind === "unresolved" || record.kind === "invalid") {
        return Object.freeze({ kind: record.kind, uncertaintyReason });
    }
    if (record.kind !== "candidate" && record.kind !== "ambiguous") {
        return null;
    }
    const candidateSymbolIds = Array.isArray(record.candidateSymbolIds)
        ? record.candidateSymbolIds.filter((candidate): candidate is string => typeof candidate === "string")
        : [];
    return Object.freeze({
        candidateSymbolIds: Object.freeze(candidateSymbolIds),
        kind: record.kind,
        uncertaintyReason
    });
}

/** Decode a persisted non-exact resolution used by rename-safety queries. */
export function parsePersistedUncertainResolution(value: string): SemanticUncertainResolution | null {
    const resolution = parsePersistedOccurrenceResolution(value);
    return resolution === null || resolution.kind === "exact" ? null : resolution;
}
