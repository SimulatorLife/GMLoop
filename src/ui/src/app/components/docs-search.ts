import type { GraphVisualizationCliCatalogEntry, GraphVisualizationMcpToolCatalogEntry } from "../../graph/types.js";
import type { GraphVisualizationUiDocsView } from "../state/types.js";
import type { GraphVisualizationDocsPanelRulesSection } from "./docs-panel-content.js";

export type CatalogSearchResult<TEntry> = Readonly<{
    entries: ReadonlyArray<TEntry>;
    totalCount: number;
}>;

export type RulesCatalogSearchResult = Readonly<{
    sections: ReadonlyArray<GraphVisualizationDocsPanelRulesSection>;
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

export function searchRulesSections(
    sections: ReadonlyArray<GraphVisualizationDocsPanelRulesSection>,
    query: string
): RulesCatalogSearchResult {
    if (query.length === 0) {
        return {
            sections,
            totalCount: sections.reduce((total, section) => total + section.items.length, 0)
        };
    }

    const filteredSections = sections.flatMap((section) => {
        const sectionMatches = fieldsMatchSearchQuery(query, [section.description, section.title]);
        const items = sectionMatches
            ? section.items
            : section.items.filter((item) => fieldsMatchSearchQuery(query, [item.detail, item.title, ...item.badges]));

        if (items.length === 0) {
            return [];
        }

        return [{ ...section, items }];
    });

    return {
        sections: filteredSections,
        totalCount: filteredSections.reduce((total, section) => total + section.items.length, 0)
    };
}

export function createSearchResultSummary(
    query: string,
    activeDocsView: GraphVisualizationUiDocsView,
    totalCount: number
): string {
    if (query.length === 0) {
        return "";
    }

    const itemLabel =
        activeDocsView === "cli"
            ? totalCount === 1
                ? "command"
                : "commands"
            : activeDocsView === "mcp"
              ? totalCount === 1
                  ? "tool"
                  : "tools"
              : totalCount === 1
                ? "rule or option"
                : "rules or options";

    return `Showing ${String(totalCount)} ${itemLabel} matching "${query}".`;
}
