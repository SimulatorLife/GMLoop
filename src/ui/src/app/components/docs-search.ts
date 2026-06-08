import type { GraphVisualizationCliCatalogEntry, GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiDocsView } from "../state/types.js";
import type { GraphVisualizationDocsPanelCatalogEntry } from "./docs-panel-content.js";

export type CatalogSearchResult<TEntry> = Readonly<{
    entries: ReadonlyArray<TEntry>;
    totalCount: number;
}>;

export function normalizeCatalogSearchQuery(query: string): string {
    return query.trim().toLowerCase();
}

function fieldMatchesSearchQuery(query: string, fieldValue: string): boolean {
    return fieldValue.toLowerCase().includes(query);
}

function fieldsMatchSearchQuery(query: string, fieldValues: ReadonlyArray<string>): boolean {
    if (query.length === 0) {
        return true;
    }

    return fieldValues.some((fieldValue) => fieldMatchesSearchQuery(query, fieldValue));
}

export function searchCliEntries(
    entries: ReadonlyArray<GraphVisualizationCliCatalogEntry>,
    query: string
): CatalogSearchResult<GraphVisualizationCliCatalogEntry> {
    if (query.length === 0) {
        return { entries, totalCount: entries.length };
    }

    const filteredEntries = entries.filter((entry) =>
        fieldsMatchSearchQuery(query, [
            entry.description,
            entry.displayName,
            entry.usage,
            ...entry.arguments.flatMap((argumentValue) => [argumentValue.description, argumentValue.name]),
            ...entry.options.flatMap((optionValue) => [optionValue.description, optionValue.flags])
        ])
    );

    return { entries: filteredEntries, totalCount: filteredEntries.length };
}

export function searchMcpEntries(
    entries: ReadonlyArray<GraphVisualizationMcpToolCatalogEntry>,
    query: string
): CatalogSearchResult<GraphVisualizationMcpToolCatalogEntry> {
    if (query.length === 0) {
        return { entries, totalCount: entries.length };
    }

    const filteredEntries = entries.filter((entry) =>
        fieldsMatchSearchQuery(query, [
            entry.commandDisplayName,
            entry.description,
            ...entry.fields.flatMap((fieldValue) => [fieldValue.description, fieldValue.name])
        ])
    );

    return { entries: filteredEntries, totalCount: filteredEntries.length };
}

export function searchCatalogEntries(
    entries: ReadonlyArray<GraphVisualizationDocsPanelCatalogEntry>,
    query: string
): CatalogSearchResult<GraphVisualizationDocsPanelCatalogEntry> {
    if (query.length === 0) {
        return { entries, totalCount: entries.length };
    }

    const filteredEntries = entries.filter((entry) =>
        fieldsMatchSearchQuery(query, [entry.title, entry.description, ...entry.badges])
    );

    return { entries: filteredEntries, totalCount: filteredEntries.length };
}

export function createSearchResultSummary(
    query: string,
    activeDocsView: GraphVisualizationUiDocsView,
    totalCount: number
): string {
    if (query.length === 0) {
        return "";
    }

    const itemLabel = createItemLabel(activeDocsView, totalCount);

    return `Showing ${String(totalCount)} ${itemLabel} matching "${query}".`;
}

function createItemLabel(activeDocsView: GraphVisualizationUiDocsView, totalCount: number): string {
    if (activeDocsView === "cli") {
        return totalCount === 1 ? "command" : "commands";
    }
    if (activeDocsView === "mcp") {
        return totalCount === 1 ? "tool" : "tools";
    }
    if (activeDocsView === "linting") {
        return totalCount === 1 ? "lint rule" : "lint rules";
    }
    if (activeDocsView === "formatting") {
        return totalCount === 1 ? "formatting option" : "formatting options";
    }
    return totalCount === 1 ? "refactor codemod" : "refactor codemods";
}

export function createNoSearchResultsMessage(query: string, activeDocsView: GraphVisualizationUiDocsView): string {
    if (query.length === 0) {
        return "";
    }

    const itemLabel = createItemLabel(activeDocsView, 0);

    return `No ${itemLabel} match “${query}”.`;
}
