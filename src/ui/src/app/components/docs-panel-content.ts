import type {
    GraphVisualizationCliCatalogEntry,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationMcpToolCatalogEntry
} from "../../graph/types.js";
import { getLintFixableBadgeLabel } from "./lint-rule-labels.js";

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
            cliMetaText: "Command help is not available right now.",
            mcpEntries: [],
            mcpMetaText: "Tool details are not available right now.",
            rulesEmptyMessage: "Rules and code actions are not available right now.",
            rulesMetaText: "Rules and code actions are not available right now.",
            rulesSections: []
        });
    }

    const rulesCatalog = catalogs.workspaceRules;
    const rulesSections = [
        Object.freeze({
            description: "Formatting options that shape how GMLoop rewrites code layout.",
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
            description: "Checks that spot common issues and can often fix them for you.",
            items: rulesCatalog.lintRules.map((entry) =>
                createRulesSectionItem(entry.ruleId, entry.description, [
                    getLintFixableBadgeLabel(entry.fixable) ?? "not-fixable"
                ])
            ),
            title: "Lint Rules"
        }),
        Object.freeze({
            description: "Project-wide refactors for larger cleanup and migration tasks.",
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
        cliMetaText: `${String(catalogs.cliCommands.length)} command${catalogs.cliCommands.length === 1 ? "" : "s"} available for working with your project.`,
        mcpEntries: catalogs.mcpTools,
        mcpMetaText: `${String(catalogs.mcpTools.length)} tool${catalogs.mcpTools.length === 1 ? "" : "s"} available for connected workflows.`,
        rulesEmptyMessage: rulesSections.every((section) => section.items.length === 0)
            ? "Rules and code actions are not available right now."
            : null,
        rulesMetaText: `${String(rulesCatalog.formatOptions.length)} format options, ${String(
            rulesCatalog.lintRules.length
        )} lint rules, and ${String(rulesCatalog.refactorCodemods.length)} refactor tools available for this project.`,
        rulesSections
    });
}
