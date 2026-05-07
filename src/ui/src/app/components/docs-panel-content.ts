import type {
    GraphVisualizationCliCatalogEntry,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationMcpToolCatalogEntry
} from "../../graph/types.js";

export type GraphVisualizationDocsPanelRulesSection = Readonly<{
    description: string;
    items: ReadonlyArray<Readonly<{ badges: ReadonlyArray<string>; detail: string; title: string }>>;
    title: string;
}>;

export type GraphVisualizationDocsPanelContent = Readonly<{
    cliEntries: ReadonlyArray<GraphVisualizationCliCatalogEntry>;
    cliMetaText: string;
    mcpEntries: ReadonlyArray<GraphVisualizationMcpToolCatalogEntry>;
    mcpMetaText: string;
    rulesEmptyMessage: string | null;
    rulesMetaText: string;
    rulesSections: ReadonlyArray<GraphVisualizationDocsPanelRulesSection>;
}>;

function createRulesSectionItem(
    title: string,
    detail: string,
    badges: ReadonlyArray<string>
): Readonly<{ badges: ReadonlyArray<string>; detail: string; title: string }> {
    return Object.freeze({
        badges,
        detail,
        title
    });
}

/**
 * Create the documentation and rules content rendered by the Lit docs panel.
 */
export function createGraphVisualizationDocsPanelContent(
    catalogs: GraphVisualizationDocumentationCatalogs | null
): GraphVisualizationDocsPanelContent {
    if (catalogs === null) {
        return Object.freeze({
            cliEntries: [],
            cliMetaText: "No CLI command catalog metadata is available for this view.",
            mcpEntries: [],
            mcpMetaText: "No MCP tool catalog metadata is available for this view.",
            rulesEmptyMessage: "No workspace rule catalog entries were provided by the host.",
            rulesMetaText: "No workspace rules metadata is available for this view.",
            rulesSections: []
        });
    }

    const rulesCatalog = catalogs.workspaceRules;
    const rulesSections = [
        Object.freeze({
            description: "Live formatter option catalog sourced from @gmloop/format.",
            items: rulesCatalog.formatOptions.map((entry) =>
                createRulesSectionItem(
                    entry.name,
                    `${entry.description} Default: ${JSON.stringify(entry.defaultValue)}.`,
                    [`default:${JSON.stringify(entry.defaultValue)}`]
                )
            ),
            title: "Format Options"
        }),
        Object.freeze({
            description: "Live lint rule catalog sourced from @gmloop/lint.",
            items: rulesCatalog.lintRules.map((entry) =>
                createRulesSectionItem(entry.ruleId, entry.description, [
                    entry.fixable === null ? "not-fixable" : `fixable:${entry.fixable}`
                ])
            ),
            title: "Lint Rules"
        }),
        Object.freeze({
            description: "Live codemod catalog sourced from @gmloop/refactor.",
            items: rulesCatalog.refactorCodemods.map((entry) =>
                createRulesSectionItem(entry.id, entry.description, [
                    entry.requiresSemanticProjectIndex ? "needs-semantic" : "semantic-optional"
                ])
            ),
            title: "Refactor Codemods"
        })
    ] satisfies ReadonlyArray<GraphVisualizationDocsPanelRulesSection>;

    return Object.freeze({
        cliEntries: catalogs.cliCommands,
        cliMetaText: `${String(catalogs.cliCommands.length)} CLI command entries sourced directly from the Commander command catalog.`,
        mcpEntries: catalogs.mcpTools,
        mcpMetaText: `${catalogs.mcpServer.name} v${catalogs.mcpServer.version} | ${String(catalogs.mcpTools.length)} MCP tools derived from the CLI catalog.`,
        rulesEmptyMessage: rulesSections.every((section) => section.items.length === 0)
            ? "No workspace rule catalog entries were provided by the host."
            : null,
        rulesMetaText: `${String(rulesCatalog.formatOptions.length)} format options, ${String(
            rulesCatalog.lintRules.length
        )} lint rules, ${String(rulesCatalog.refactorCodemods.length)} refactor codemods loaded directly from workspace registries.`,
        rulesSections
    });
}
