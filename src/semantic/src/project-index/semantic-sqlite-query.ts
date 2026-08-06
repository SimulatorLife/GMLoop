import path from "node:path";

import type { GraphDatabase } from "../graph-index/sqlite-adapter.js";
import { getGmlSymbolKindSpecificity, normalizeGmlSemanticSymbolKind } from "../symbols/taxonomy.js";
import { listSemanticRenameSafetyGapsForFacts } from "./rename-safety.js";
import { normalizeSemanticFilePath } from "./semantic-path.js";
import {
    compareSemanticQueryText,
    normalizeSemanticSearchText,
    readSemanticSearchNgram
} from "./semantic-query-order.js";
import type {
    SemanticEnumMember,
    SemanticResourceQueryResult,
    SemanticSnapshotQueries,
    SemanticSymbolOccurrenceMatch
} from "./semantic-query-types.js";
import {
    parsePersistedOccurrenceResolution,
    parsePersistedSemanticDocumentation,
    parsePersistedUncertainResolution,
    parseSemanticRecordPayload
} from "./semantic-record-codec.js";
import type {
    SemanticOccurrence,
    SemanticSymbol,
    SemanticTier,
    SemanticUnresolvedReference
} from "./semantic-snapshot.js";
import { createEmptyGmlSymbolDocumentation, type GmlSymbolDocumentation } from "./symbol-documentation.js";

type SemanticSqliteValue = bigint | number | string | Uint8Array | null;
type SemanticSqliteRow = Readonly<Record<string, SemanticSqliteValue>>;

type SemanticSymbolRow = Readonly<{
    defining_file_path: string | null;
    display_name: string;
    documentation_json: string;
    kind: string;
    name: string;
    symbol_scope_id: string | null;
    symbol_id: string;
}>;

type SemanticOccurrenceRow = Readonly<{
    end_offset: number;
    file_path: string;
    resolution_json: string;
    role: "definition" | "reference";
    occurrence_scope_id: string | null;
    start_offset: number;
    symbol_id: string;
}>;

type SemanticSymbolOccurrenceRow = SemanticOccurrenceRow & SemanticSymbolRow;

type SemanticResourceRow = Readonly<{
    file_path: string | null;
    name: string;
    resource_path: string;
    resource_type: string;
}>;

type SemanticRelationshipPayloadRow = Readonly<{ payload_json: string }>;

type SemanticParameterDocumentationRow = Readonly<{
    documentation_json: string;
    start_offset: number;
}>;

type SemanticUnresolvedReferenceRow = Readonly<{
    end_offset: number;
    file_path: string;
    name: string;
    resolution_json: string;
    start_offset: number;
}>;

function readNullableString(value: SemanticSqliteValue | undefined): string | null {
    return typeof value === "string" ? value : null;
}

function decodeSemanticSymbolRow(row: SemanticSqliteRow): SemanticSymbolRow | null {
    return typeof row.symbol_id === "string" &&
        typeof row.kind === "string" &&
        typeof row.name === "string" &&
        typeof row.display_name === "string" &&
        typeof row.documentation_json === "string"
        ? Object.freeze({
              defining_file_path: readNullableString(row.defining_file_path),
              display_name: row.display_name,
              documentation_json: row.documentation_json,
              kind: row.kind,
              name: row.name,
              symbol_id: row.symbol_id,
              symbol_scope_id: readNullableString(row.symbol_scope_id)
          })
        : null;
}

function decodeSemanticOccurrenceRow(row: SemanticSqliteRow): SemanticOccurrenceRow | null {
    return typeof row.symbol_id === "string" &&
        typeof row.file_path === "string" &&
        (row.role === "definition" || row.role === "reference") &&
        typeof row.start_offset === "number" &&
        typeof row.end_offset === "number" &&
        typeof row.resolution_json === "string"
        ? Object.freeze({
              end_offset: row.end_offset,
              file_path: row.file_path,
              occurrence_scope_id: readNullableString(row.occurrence_scope_id),
              resolution_json: row.resolution_json,
              role: row.role,
              start_offset: row.start_offset,
              symbol_id: row.symbol_id
          })
        : null;
}

function decodeSemanticSymbolOccurrenceRow(row: SemanticSqliteRow): SemanticSymbolOccurrenceRow | null {
    const symbol = decodeSemanticSymbolRow(row);
    const occurrence = decodeSemanticOccurrenceRow(row);
    return symbol === null || occurrence === null ? null : Object.freeze({ ...symbol, ...occurrence });
}

function decodeParameterDocumentationRow(row: SemanticSqliteRow): SemanticParameterDocumentationRow | null {
    return typeof row.documentation_json === "string" && typeof row.start_offset === "number"
        ? Object.freeze({ documentation_json: row.documentation_json, start_offset: row.start_offset })
        : null;
}

function decodeResourceRow(row: SemanticSqliteRow): SemanticResourceRow | null {
    return typeof row.name === "string" &&
        typeof row.resource_path === "string" &&
        typeof row.resource_type === "string"
        ? Object.freeze({
              file_path: readNullableString(row.file_path),
              name: row.name,
              resource_path: row.resource_path,
              resource_type: row.resource_type
          })
        : null;
}

function decodeRelationshipPayloadRow(row: SemanticSqliteRow): SemanticRelationshipPayloadRow | null {
    return typeof row.payload_json === "string" ? Object.freeze({ payload_json: row.payload_json }) : null;
}

function decodeUnresolvedReferenceRow(row: SemanticSqliteRow): SemanticUnresolvedReferenceRow | null {
    return typeof row.name === "string" &&
        typeof row.file_path === "string" &&
        typeof row.start_offset === "number" &&
        typeof row.end_offset === "number" &&
        typeof row.resolution_json === "string"
        ? Object.freeze({
              end_offset: row.end_offset,
              file_path: row.file_path,
              name: row.name,
              resolution_json: row.resolution_json,
              start_offset: row.start_offset
          })
        : null;
}

function decodeRows<Row>(
    rows: ReadonlyArray<SemanticSqliteRow>,
    decode: (row: SemanticSqliteRow) => Row | null
): ReadonlyArray<Row> {
    return rows.flatMap((row) => {
        const decoded = decode(row);
        return decoded === null ? [] : [decoded];
    });
}

function createSemanticSymbol(row: SemanticSymbolRow): SemanticSymbol {
    return Object.freeze({
        definingFilePath: row.defining_file_path,
        displayName: row.display_name,
        documentation: parsePersistedSemanticDocumentation(row.documentation_json),
        kind: row.kind,
        name: row.name,
        scopeId: row.symbol_scope_id,
        symbolId: row.symbol_id
    });
}

function createSemanticOccurrence(row: SemanticOccurrenceRow): SemanticOccurrence | null {
    const resolution = parsePersistedOccurrenceResolution(row.resolution_json);
    return resolution === null
        ? null
        : Object.freeze({
              end: row.end_offset,
              filePath: row.file_path,
              resolution,
              role: row.role,
              scopeId: row.occurrence_scope_id,
              start: row.start_offset,
              symbolId: row.symbol_id
          });
}

function compareMatches(left: SemanticSymbolOccurrenceMatch, right: SemanticSymbolOccurrenceMatch): number {
    const pathComparison = compareSemanticQueryText(left.occurrence.filePath, right.occurrence.filePath);
    if (pathComparison !== 0) {
        return pathComparison;
    }
    if (left.occurrence.start !== right.occurrence.start) {
        return left.occurrence.start - right.occurrence.start;
    }
    if (left.occurrence.end !== right.occurrence.end) {
        return left.occurrence.end - right.occurrence.end;
    }
    return compareSemanticQueryText(left.symbol.symbolId, right.symbol.symbolId);
}

function comparePreferredSymbols(left: SemanticSymbol, right: SemanticSymbol): number {
    const leftSpecificity = getGmlSymbolKindSpecificity(normalizeGmlSemanticSymbolKind(left.kind));
    const rightSpecificity = getGmlSymbolKindSpecificity(normalizeGmlSemanticSymbolKind(right.kind));
    return leftSpecificity === rightSpecificity
        ? compareSemanticQueryText(left.symbolId, right.symbolId)
        : rightSpecificity - leftSpecificity;
}

function createParameterDocumentation(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier,
    parameter: SemanticSymbol
): GmlSymbolDocumentation {
    const definitionRow = database
        .prepare(
            "SELECT file_path, start_offset FROM semantic_occurrences " +
                "WHERE project_root = ? AND tier = ? AND symbol_id = ? AND role = 'definition' " +
                "ORDER BY file_path, start_offset LIMIT 1"
        )
        .get(projectRoot, tier, parameter.symbolId);
    const definition =
        definitionRow !== undefined &&
        typeof definitionRow.file_path === "string" &&
        typeof definitionRow.start_offset === "number"
            ? Object.freeze({ filePath: definitionRow.file_path, startOffset: definitionRow.start_offset })
            : null;
    if (definition === null) {
        return parameter.documentation;
    }
    const candidates = decodeRows(
        database
            .prepare(
                "SELECT symbols.documentation_json, occurrences.start_offset " +
                    "FROM semantic_symbols AS symbols " +
                    "JOIN semantic_occurrences AS occurrences " +
                    "ON occurrences.project_root = symbols.project_root AND occurrences.tier = symbols.tier " +
                    "AND occurrences.symbol_id = symbols.symbol_id " +
                    "WHERE symbols.project_root = ? AND symbols.tier = ? AND occurrences.role = 'definition' " +
                    "AND occurrences.file_path = ? AND occurrences.start_offset <= ? AND symbols.symbol_id <> ? " +
                    "ORDER BY occurrences.start_offset DESC, symbols.symbol_id"
            )
            .all(projectRoot, tier, definition.filePath, definition.startOffset, parameter.symbolId),
        decodeParameterDocumentationRow
    );
    for (const candidate of candidates) {
        const documentation = parsePersistedSemanticDocumentation(candidate.documentation_json);
        const documentedParameter = documentation.parameters.find((entry) => entry.name === parameter.name);
        if (documentedParameter === undefined) {
            continue;
        }
        const empty = createEmptyGmlSymbolDocumentation();
        return Object.freeze({
            additionalTags: empty.additionalTags,
            description: empty.description,
            normalizedText: "",
            parameters: Object.freeze([documentedParameter]),
            returns: empty.returns
        });
    }
    return parameter.documentation;
}

/** Create indexed query roles over one already-pinned SQLite read transaction. */
export function createSemanticSqliteSnapshotQueries(
    database: GraphDatabase,
    projectRoot: string,
    tier: SemanticTier
): SemanticSnapshotQueries {
    const symbolCache = new Map<string, SemanticSymbol | null>();

    const enrichSymbol = (symbol: SemanticSymbol): SemanticSymbol => {
        if (symbol.kind !== "parameter" || symbol.documentation.parameters.length > 0) {
            return symbol;
        }
        const documentation = createParameterDocumentation(database, projectRoot, tier, symbol);
        return documentation === symbol.documentation ? symbol : Object.freeze({ ...symbol, documentation });
    };

    const cacheSymbol = (row: SemanticSymbolRow): SemanticSymbol => {
        const cached = symbolCache.get(row.symbol_id);
        if (cached !== undefined && cached !== null) {
            return cached;
        }
        const symbol = enrichSymbol(createSemanticSymbol(row));
        symbolCache.set(symbol.symbolId, symbol);
        return symbol;
    };

    const findSymbol = (symbolId: string): SemanticSymbol | null => {
        const cached = symbolCache.get(symbolId);
        if (cached !== undefined) {
            return cached;
        }
        const rawRow = database
            .prepare(
                "SELECT symbol_id, kind, name, display_name, defining_file_path, " +
                    "scope_id AS symbol_scope_id, documentation_json " +
                    "FROM semantic_symbols WHERE project_root = ? AND tier = ? AND symbol_id = ?"
            )
            .get(projectRoot, tier, symbolId);
        const row = rawRow === undefined ? null : decodeSemanticSymbolRow(rawRow);
        const symbol = row === null ? null : enrichSymbol(createSemanticSymbol(row));
        symbolCache.set(symbolId, symbol);
        return symbol;
    };

    const createMatch = (row: SemanticSymbolOccurrenceRow): SemanticSymbolOccurrenceMatch | null => {
        const occurrence = createSemanticOccurrence(row);
        return occurrence === null ? null : Object.freeze({ occurrence, symbol: cacheSymbol(row) });
    };

    const createMatches = (
        rows: ReadonlyArray<SemanticSymbolOccurrenceRow>
    ): ReadonlyArray<SemanticSymbolOccurrenceMatch> =>
        Object.freeze(
            rows
                .flatMap((row) => {
                    const match = createMatch(row);
                    return match === null ? [] : [match];
                })
                .toSorted(compareMatches)
        );

    const occurrenceSelect =
        "SELECT occurrences.symbol_id, occurrences.file_path, occurrences.role, occurrences.start_offset, " +
        "occurrences.end_offset, occurrences.scope_id AS occurrence_scope_id, occurrences.resolution_json, " +
        "symbols.kind, symbols.name, symbols.display_name, symbols.defining_file_path, " +
        "symbols.scope_id AS symbol_scope_id, symbols.documentation_json " +
        "FROM semantic_occurrences AS occurrences JOIN semantic_symbols AS symbols " +
        "ON symbols.project_root = occurrences.project_root AND symbols.tier = occurrences.tier " +
        "AND symbols.symbol_id = occurrences.symbol_id ";

    const findSymbolAtPosition = (filePath: string, offset: number): SemanticSymbolOccurrenceMatch | null => {
        const rows = decodeRows(
            database
                .prepare(
                    `${
                        occurrenceSelect
                    }WHERE occurrences.project_root = ? AND occurrences.tier = ? AND occurrences.file_path = ? ` +
                        `AND occurrences.start_offset <= ? AND occurrences.end_offset > ?`
                )
                .all(projectRoot, tier, normalizeSemanticFilePath(projectRoot, filePath), offset, offset),
            decodeSemanticSymbolOccurrenceRow
        );
        const matches = rows.flatMap((row) => {
            const match = createMatch(row);
            return match === null ? [] : [match];
        });
        matches.sort((left, right) => {
            const leftLength = left.occurrence.end - left.occurrence.start;
            const rightLength = right.occurrence.end - right.occurrence.start;
            return leftLength === rightLength
                ? comparePreferredSymbols(left.symbol, right.symbol)
                : leftLength - rightLength;
        });
        return matches[0] ?? null;
    };

    const resolveSymbolId = (name: string): string | null => {
        const rows = decodeRows(
            database
                .prepare(
                    "SELECT symbol_id, kind, name, display_name, defining_file_path, " +
                        "scope_id AS symbol_scope_id, documentation_json " +
                        "FROM semantic_symbols WHERE project_root = ? AND tier = ? AND (name = ? OR display_name = ?)"
                )
                .all(projectRoot, tier, name, name),
            decodeSemanticSymbolRow
        );
        const symbols = rows.map((row) => cacheSymbol(row)).toSorted(comparePreferredSymbols);
        return symbols[0]?.symbolId ?? null;
    };

    const findDefinitions = (symbolId: string): ReadonlyArray<SemanticSymbolOccurrenceMatch> =>
        createMatches(
            decodeRows(
                database
                    .prepare(
                        `${occurrenceSelect}WHERE occurrences.project_root = ? AND occurrences.tier = ? ` +
                            `AND occurrences.symbol_id = ? AND occurrences.role = 'definition' ` +
                            `ORDER BY occurrences.file_path, occurrences.start_offset, occurrences.end_offset`
                    )
                    .all(projectRoot, tier, symbolId),
                decodeSemanticSymbolOccurrenceRow
            )
        );

    const findReferences = (
        symbolId: string,
        includeDefinitions: boolean
    ): ReadonlyArray<SemanticSymbolOccurrenceMatch> => {
        const rawRows = includeDefinitions
            ? database
                  .prepare(
                      `${occurrenceSelect}WHERE occurrences.project_root = ? AND occurrences.tier = ? ` +
                          `AND occurrences.symbol_id = ? ` +
                          `ORDER BY occurrences.file_path, occurrences.start_offset, occurrences.end_offset`
                  )
                  .all(projectRoot, tier, symbolId)
            : database
                  .prepare(
                      `${occurrenceSelect}WHERE occurrences.project_root = ? AND occurrences.tier = ? ` +
                          `AND occurrences.symbol_id = ? AND occurrences.role = 'reference' ` +
                          `ORDER BY occurrences.file_path, occurrences.start_offset, occurrences.end_offset`
                  )
                  .all(projectRoot, tier, symbolId);
        const rows = decodeRows(rawRows, decodeSemanticSymbolOccurrenceRow);
        return createMatches(rows);
    };

    const listDocumentSymbols = (filePath: string): ReadonlyArray<SemanticSymbolOccurrenceMatch> =>
        createMatches(
            decodeRows(
                database
                    .prepare(
                        `${occurrenceSelect}WHERE occurrences.project_root = ? AND occurrences.tier = ? ` +
                            `AND occurrences.file_path = ? AND occurrences.role = 'definition' ` +
                            `ORDER BY occurrences.start_offset, occurrences.end_offset, occurrences.symbol_id`
                    )
                    .all(projectRoot, tier, normalizeSemanticFilePath(projectRoot, filePath)),
                decodeSemanticSymbolOccurrenceRow
            )
        );

    const listFileOccurrences = (filePath: string): ReadonlyArray<SemanticSymbolOccurrenceMatch> =>
        createMatches(
            decodeRows(
                database
                    .prepare(
                        `${
                            occurrenceSelect
                        }WHERE occurrences.project_root = ? AND occurrences.tier = ? AND occurrences.file_path = ? ` +
                            `ORDER BY occurrences.start_offset, occurrences.end_offset, occurrences.symbol_id`
                    )
                    .all(projectRoot, tier, normalizeSemanticFilePath(projectRoot, filePath)),
                decodeSemanticSymbolOccurrenceRow
            )
        );

    const searchWorkspaceSymbols = (query: string, limit: number): ReadonlyArray<SemanticSymbol> => {
        const boundedLimit = Math.max(0, Math.floor(limit));
        if (boundedLimit === 0) {
            return Object.freeze([]);
        }
        const normalizedQuery = normalizeSemanticSearchText(query);
        const selectedColumns =
            "symbols.symbol_id, symbols.kind, symbols.name, symbols.display_name, symbols.defining_file_path, " +
            "symbols.scope_id AS symbol_scope_id, symbols.documentation_json ";
        const rawRows =
            normalizedQuery.length === 0
                ? database
                      .prepare(
                          `SELECT ${selectedColumns}FROM semantic_symbols AS symbols ` +
                              "WHERE symbols.project_root = ? AND symbols.tier = ? " +
                              "ORDER BY symbols.normalized_display_name COLLATE BINARY, " +
                              "symbols.symbol_id COLLATE BINARY LIMIT ?"
                      )
                      .all(projectRoot, tier, boundedLimit)
                : database
                      .prepare(
                          "WITH candidates AS MATERIALIZED (" +
                              "SELECT project_root, tier, symbol_id FROM semantic_symbol_search_ngrams " +
                              "INDEXED BY idx_semantic_symbol_search_ngram " +
                              "WHERE project_root = ? AND tier = ? AND search_ngram = ?) " +
                              `SELECT ${selectedColumns}FROM candidates ` +
                              "JOIN semantic_symbols AS symbols ON symbols.project_root = candidates.project_root " +
                              "AND symbols.tier = candidates.tier AND symbols.symbol_id = candidates.symbol_id " +
                              "WHERE instr(symbols.normalized_display_name, ?) > 0 " +
                              "ORDER BY symbols.normalized_display_name COLLATE BINARY, " +
                              "symbols.symbol_id COLLATE BINARY LIMIT ?"
                      )
                      .all(projectRoot, tier, readSemanticSearchNgram(normalizedQuery), normalizedQuery, boundedLimit);
        const rows = decodeRows(rawRows, decodeSemanticSymbolRow);
        return Object.freeze(rows.map((row) => cacheSymbol(row)));
    };

    const createResourceQueryResults = (
        rows: ReadonlyArray<SemanticResourceRow>
    ): ReadonlyArray<SemanticResourceQueryResult> => {
        const resources = new Map<
            string,
            { filePaths: Set<string>; name: string; resourcePath: string; resourceType: string }
        >();
        for (const row of rows) {
            const resource = resources.get(row.resource_path) ?? {
                filePaths: new Set<string>(),
                name: row.name,
                resourcePath: row.resource_path,
                resourceType: row.resource_type
            };
            if (row.file_path !== null) {
                resource.filePaths.add(row.file_path);
            }
            resources.set(row.resource_path, resource);
        }
        return Object.freeze(
            [...resources.values()]
                .toSorted((left, right) => compareSemanticQueryText(left.resourcePath, right.resourcePath))
                .map((resource) =>
                    Object.freeze({
                        filePaths: Object.freeze([...resource.filePaths].toSorted(compareSemanticQueryText)),
                        name: resource.name,
                        resourcePath: resource.resourcePath,
                        resourceType: resource.resourceType
                    })
                )
        );
    };

    const resourceSelect =
        "SELECT resources.resource_path, resources.name, resources.resource_type, scope_files.file_path " +
        "FROM semantic_resources AS resources " +
        "LEFT JOIN semantic_scopes AS scopes ON scopes.project_root = resources.project_root " +
        "AND scopes.tier = resources.tier AND scopes.resource_path = resources.resource_path " +
        "LEFT JOIN semantic_scope_files AS scope_files ON scope_files.project_root = scopes.project_root " +
        "AND scope_files.tier = scopes.tier AND scope_files.scope_id = scopes.scope_id ";

    const listResources = (): ReadonlyArray<SemanticResourceQueryResult> =>
        createResourceQueryResults(
            decodeRows(
                database
                    .prepare(
                        `${resourceSelect}WHERE resources.project_root = ? AND resources.tier = ? ` +
                            "ORDER BY resources.resource_path COLLATE BINARY, scope_files.file_path COLLATE BINARY"
                    )
                    .all(projectRoot, tier),
                decodeResourceRow
            )
        );

    const findResourcesByNames = (names: ReadonlyArray<string>): ReadonlyArray<SemanticResourceQueryResult> => {
        const uniqueNames = [...new Set(names)].toSorted(compareSemanticQueryText);
        if (uniqueNames.length === 0) {
            return Object.freeze([]);
        }
        const selectResourceByName = database.prepare(
            `${resourceSelect}WHERE resources.project_root = ? AND resources.tier = ? AND resources.name = ? ` +
                "ORDER BY resources.resource_path COLLATE BINARY, scope_files.file_path COLLATE BINARY"
        );
        return createResourceQueryResults(
            uniqueNames.flatMap((name) =>
                decodeRows(selectResourceByName.all(projectRoot, tier, name), decodeResourceRow)
            )
        );
    };

    const findEnumOwner = (symbolId: string): SemanticSymbol | null => {
        const symbol = findSymbol(symbolId);
        if (symbol?.kind === "enum") {
            return symbol;
        }
        if (symbol?.kind !== "enumMember") {
            return null;
        }
        const rawRow = database
            .prepare(
                "SELECT payload_json FROM semantic_relationships WHERE project_root = ? AND tier = ? " +
                    "AND relationship_kind = 'enumMember' AND json_extract(payload_json, '$.memberSymbolId') = ? " +
                    "ORDER BY relationship_id LIMIT 1"
            )
            .get(projectRoot, tier, symbolId);
        const row = rawRow === undefined ? null : decodeRelationshipPayloadRow(rawRow);
        const payload = row === null ? null : parseSemanticRecordPayload(row.payload_json);
        return payload !== null && typeof payload.enumSymbolId === "string" ? findSymbol(payload.enumSymbolId) : null;
    };

    const listEnumMembers = (symbolId: string): ReadonlyArray<SemanticEnumMember> => {
        if (findSymbol(symbolId)?.kind !== "enum") {
            return Object.freeze([]);
        }
        const rows = decodeRows(
            database
                .prepare(
                    "SELECT payload_json FROM semantic_relationships WHERE project_root = ? AND tier = ? " +
                        "AND relationship_kind = 'enumMember' AND json_extract(payload_json, '$.enumSymbolId') = ? " +
                        "ORDER BY CAST(json_extract(payload_json, '$.order') AS INTEGER), relationship_id"
                )
                .all(projectRoot, tier, symbolId),
            decodeRelationshipPayloadRow
        );
        return Object.freeze(
            rows
                .flatMap((row): ReadonlyArray<SemanticEnumMember> => {
                    const payload = parseSemanticRecordPayload(row.payload_json);
                    if (
                        payload === null ||
                        typeof payload.memberSymbolId !== "string" ||
                        typeof payload.memberName !== "string" ||
                        typeof payload.order !== "number"
                    ) {
                        return [];
                    }
                    return [
                        Object.freeze({
                            name: payload.memberName,
                            order: payload.order,
                            symbolId: payload.memberSymbolId,
                            value: typeof payload.value === "string" ? payload.value : null
                        })
                    ];
                })
                .toSorted(
                    (left, right) =>
                        left.order - right.order ||
                        compareSemanticQueryText(left.name, right.name) ||
                        compareSemanticQueryText(left.symbolId, right.symbolId)
                )
        );
    };

    const listUnresolvedReferences = (name: string): ReadonlyArray<SemanticUnresolvedReference> => {
        const rows = decodeRows(
            database
                .prepare(
                    "SELECT name, file_path, start_offset, end_offset, resolution_json " +
                        "FROM semantic_unresolved_references WHERE project_root = ? AND tier = ? AND name = ? " +
                        "ORDER BY file_path, start_offset, end_offset"
                )
                .all(projectRoot, tier, name),
            decodeUnresolvedReferenceRow
        );
        return Object.freeze(
            rows.flatMap((row): ReadonlyArray<SemanticUnresolvedReference> => {
                const resolution = parsePersistedUncertainResolution(row.resolution_json);
                return resolution === null
                    ? []
                    : [
                          Object.freeze({
                              end: row.end_offset,
                              filePath: row.file_path,
                              name: row.name,
                              resolution,
                              start: row.start_offset
                          })
                      ];
            })
        );
    };

    const queries: SemanticSnapshotQueries = Object.freeze({
        findSymbolAtPosition,
        findSymbol,
        resolveSymbolId,
        hasSymbol: (symbolId) => findSymbol(symbolId) !== null,
        findDefinitions,
        findReferences,
        listDocumentSymbols,
        searchWorkspaceSymbols,
        listFileOccurrences,
        listResources,
        findResourcesByNames,
        findEnumOwner,
        listEnumMembers,
        refactor: Object.freeze({
            getFileSymbols(filePath) {
                const rows = database
                    .prepare(
                        "SELECT DISTINCT symbol_id FROM semantic_occurrences WHERE project_root = ? AND tier = ? " +
                            "AND file_path = ? AND role = 'definition' ORDER BY symbol_id"
                    )
                    .all(projectRoot, tier, normalizeSemanticFilePath(projectRoot, filePath));
                return rows.flatMap((row) =>
                    typeof row.symbol_id === "string" ? [Object.freeze({ id: row.symbol_id })] : []
                );
            },
            getRenameSafetyGaps(symbolId) {
                const symbol = findSymbol(symbolId);
                return [
                    ...listSemanticRenameSafetyGapsForFacts(
                        tier,
                        symbol,
                        symbol === null ? [] : listUnresolvedReferences(symbol.name),
                        symbolId
                    )
                ];
            },
            getSymbolAtPosition(filePath, offset) {
                const match = findSymbolAtPosition(filePath, offset);
                return match === null
                    ? null
                    : Object.freeze({
                          name: match.symbol.name,
                          range: Object.freeze({ end: match.occurrence.end, start: match.occurrence.start }),
                          symbolId: match.symbol.symbolId
                      });
            },
            getSymbolOccurrences(symbolName, symbolId = null) {
                const resolvedSymbolId = symbolId ?? resolveSymbolId(symbolName);
                return resolvedSymbolId === null
                    ? []
                    : findReferences(resolvedSymbolId, true).map((match) =>
                          Object.freeze({
                              end: match.occurrence.end,
                              kind: match.occurrence.role,
                              path: path.resolve(projectRoot, match.occurrence.filePath),
                              scopeId: match.occurrence.scopeId ?? undefined,
                              start: match.occurrence.start
                          })
                      );
            },
            hasSymbol: (symbolId) => findSymbol(symbolId) !== null,
            resolveSymbolId
        })
    });
    return queries;
}
