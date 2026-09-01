import type {
    GraphVisualizationCliCatalogEntry,
    GraphVisualizationDocumentationCatalogs,
    GraphVisualizationLspToolCatalogEntry,
    GraphVisualizationMcpToolCatalogEntry
} from "../../graph/index.js";
import { getLintFixableBadgeLabel } from "./lint-rule-levels.js";

export type GraphVisualizationDocsPanelCatalogEntry = Readonly<{
    badges: ReadonlyArray<string>;
    description: string;
    title: string;
}>;

export type GraphVisualizationDocsPanelContent = Readonly<{
    cliEntries: ReadonlyArray<GraphVisualizationCliCatalogEntry>;
    cliMetaText: string;
    lspEntries: ReadonlyArray<GraphVisualizationLspToolCatalogEntry>;
    lspMetaText: string;
    lspEmptyMessage: string | null;
    mcpEntries: ReadonlyArray<GraphVisualizationMcpToolCatalogEntry>;
    mcpMetaText: string;
    lintingEntries: ReadonlyArray<GraphVisualizationDocsPanelCatalogEntry>;
    lintingMetaText: string;
    lintingEmptyMessage: string | null;
    formattingEntries: ReadonlyArray<GraphVisualizationDocsPanelCatalogEntry>;
    formattingMetaText: string;
    formattingEmptyMessage: string | null;
    codemodsEntries: ReadonlyArray<GraphVisualizationDocsPanelCatalogEntry>;
    codemodsMetaText: string;
    codemodsEmptyMessage: string | null;
}>;

const LINTING_EMPTY_MESSAGE = "Linting rules are not available right now.";
const FORMATTING_EMPTY_MESSAGE = "Formatting options are not available right now.";
const CODEMODS_EMPTY_MESSAGE = "Refactor codemods are not available right now.";

function createLintEntry(
    ruleId: string,
    description: string,
    fixable: "code" | "whitespace" | null
): GraphVisualizationDocsPanelCatalogEntry {
    return Object.freeze({
        badges: [getLintFixableBadgeLabel(fixable) ?? "not-fixable"],
        description,
        title: ruleId
    });
}

function createFormattingEntry(
    name: string,
    description: string,
    defaultValue: unknown
): GraphVisualizationDocsPanelCatalogEntry {
    return Object.freeze({
        badges: [`default:${JSON.stringify(defaultValue)}`],
        description: `${description} Default: ${JSON.stringify(defaultValue)}.`,
        title: name
    });
}

function createCodemodEntry(
    id: string,
    description: string,
    requiresSemanticProjectIndex: boolean
): GraphVisualizationDocsPanelCatalogEntry {
    return Object.freeze({
        badges: [requiresSemanticProjectIndex ? "needs-semantic" : "semantic-optional"],
        description,
        title: id
    });
}

const LSP_EMPTY_MESSAGE = "LSP tools are not available right now.";

/**
 * Create the documentation content rendered by the Lit docs panel.
 */
export function createGraphVisualizationDocsPanelContent(
    catalogs: GraphVisualizationDocumentationCatalogs | null
): GraphVisualizationDocsPanelContent {
    if (catalogs === null) {
        return Object.freeze({
            cliEntries: [],
            cliMetaText: "Command help is not available right now.",
            lspEntries: [],
            lspMetaText: "LSP tools are not available right now.",
            lspEmptyMessage: LSP_EMPTY_MESSAGE,
            mcpEntries: [],
            mcpMetaText: "Tool details are not available right now.",
            lintingEntries: [],
            lintingMetaText: "Linting rules are not available right now.",
            lintingEmptyMessage: LINTING_EMPTY_MESSAGE,
            formattingEntries: [],
            formattingMetaText: "Formatting options are not available right now.",
            formattingEmptyMessage: FORMATTING_EMPTY_MESSAGE,
            codemodsEntries: [],
            codemodsMetaText: "Refactor codemods are not available right now.",
            codemodsEmptyMessage: CODEMODS_EMPTY_MESSAGE
        });
    }

    const rulesCatalog = catalogs.workspaceRules;
    const lintingEntries = rulesCatalog.lintRules.map((entry) =>
        createLintEntry(entry.ruleId, entry.description, entry.fixable)
    );
    const formattingEntries = rulesCatalog.formatOptions.map((entry) =>
        createFormattingEntry(entry.name, entry.description, entry.defaultValue)
    );
    const codemodsEntries = rulesCatalog.refactorCodemods.map((entry) =>
        createCodemodEntry(entry.id, entry.description, entry.requiresSemanticProjectIndex)
    );
    const lspEntries = catalogs.lspTools ?? [];

    return Object.freeze({
        cliEntries: catalogs.cliCommands,
        cliMetaText: `${String(catalogs.cliCommands.length)} command${catalogs.cliCommands.length === 1 ? "" : "s"} available for working with your project.`,
        lspEntries,
        lspMetaText: `${String(lspEntries.length)} tool${lspEntries.length === 1 ? "" : "s"} available for editor and LSP-MCP integration.`,
        lspEmptyMessage: lspEntries.length === 0 ? LSP_EMPTY_MESSAGE : null,
        mcpEntries: catalogs.mcpTools,
        mcpMetaText: `${String(catalogs.mcpTools.length)} tool${catalogs.mcpTools.length === 1 ? "" : "s"} available for connected workflows.`,
        lintingEntries,
        lintingMetaText: `${String(lintingEntries.length)} lint rule${lintingEntries.length === 1 ? "" : "s"} available for this project.`,
        lintingEmptyMessage: lintingEntries.length === 0 ? LINTING_EMPTY_MESSAGE : null,
        formattingEntries,
        formattingMetaText: `${String(formattingEntries.length)} formatting option${formattingEntries.length === 1 ? "" : "s"} available for this project.`,
        formattingEmptyMessage: formattingEntries.length === 0 ? FORMATTING_EMPTY_MESSAGE : null,
        codemodsEntries,
        codemodsMetaText: `${String(codemodsEntries.length)} refactor codemod${codemodsEntries.length === 1 ? "" : "s"} available for this project.`,
        codemodsEmptyMessage: codemodsEntries.length === 0 ? CODEMODS_EMPTY_MESSAGE : null
    });
}
