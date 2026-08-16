import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { Format } from "@gmloop/format";
import { listLintRuleCatalogEntries } from "@gmloop/lint";
import { Refactor } from "@gmloop/refactor";

import type { CliCatalogEntry } from "../../../cli-core/command-catalog.js";
import type { McpToolCatalogEntry } from "../../../cli-core/mcp-tool-catalog.js";

/**
 * Catalog lookups are injected rather than imported from `cli.ts` directly.
 * `cli.ts` registers every command (including this `graph visualize` command)
 * before it can expose a complete catalog, so a static import here would
 * create a module cycle back through the command-registration chain.
 */
type DocumentationCatalogProviders = Readonly<{
    getCliCommandCatalog: () => ReadonlyArray<CliCatalogEntry>;
    getMcpToolCatalogEntries: (options?: { includeInternal?: boolean }) => ReadonlyArray<McpToolCatalogEntry>;
}>;

function loadLspToolsCatalogEntries(): ReadonlyArray<{
    description: string;
    displayName: string;
    fields: ReadonlyArray<{
        choices: ReadonlyArray<string> | undefined;
        default: unknown;
        description: string;
        name: string;
        required: boolean;
        type: string;
    }>;
    name: string;
}> {
    try {
        const resolvedPath = fileURLToPath(import.meta.resolve("lsp-mcp-server"));
        const code = readFileSync(resolvedPath, "utf8");
        const match = code.match(/const TOOLS\s*=\s*(\[[\s\S]*?\]);\s*const toolHandlers/);
        if (!match) {
            return [];
        }
        const toolsString = match[1];
        const rawTools = vm.runInNewContext(toolsString) as ReadonlyArray<any>;

        return rawTools.map((rawTool) => {
            const properties = rawTool.inputSchema?.properties ?? {};
            const requiredFields = new Set<string>(rawTool.inputSchema?.required);
            const fields = Object.entries(properties).map(([fieldName, prop]: [string, any]) => {
                return Object.freeze({
                    choices: Array.isArray(prop.enum) ? Object.freeze(prop.enum.map(String)) : undefined,
                    default: prop.default,
                    description: prop.description ?? "",
                    name: fieldName,
                    required: requiredFields.has(fieldName),
                    type: prop.type ?? "string"
                });
            });
            return Object.freeze({
                description: rawTool.description ?? "",
                displayName: rawTool.annotations?.title ?? rawTool.name,
                fields: Object.freeze(fields),
                name: rawTool.name
            });
        });
    } catch {
        return [];
    }
}

function createDocumentationCatalogs({
    getCliCommandCatalog,
    getMcpToolCatalogEntries
}: DocumentationCatalogProviders) {
    const cliCommands = getCliCommandCatalog();
    const lintCatalogEntryById = new Map(listLintRuleCatalogEntries().map((entry) => [entry.ruleId, entry] as const));
    const semanticIndexCodemodIdSet = new Set(Refactor.listSemanticProjectIndexDependentCodemodIds());
    const lspTools = loadLspToolsCatalogEntries();

    return Object.freeze({
        cliCommands,
        lspTools,
        mcpServer: Object.freeze({
            name: "gmloop-mcp",
            version: "0.0.1"
        }),
        mcpTools: getMcpToolCatalogEntries({ includeInternal: true }),
        workspaceRules: Object.freeze({
            formatOptions: Format.projectFormatOptionCatalog.map((entry) =>
                Object.freeze({
                    defaultValue: entry.defaultValue,
                    description: entry.description,
                    name: entry.name
                })
            ),
            lintRules: listLintRuleCatalogEntries().map((entry) =>
                Object.freeze({
                    description: lintCatalogEntryById.get(entry.ruleId)?.description ?? entry.description,
                    fixable: entry.fixable,
                    ruleId: entry.ruleId
                })
            ),
            refactorCodemods: Refactor.listRegisteredCodemods().map((entry) =>
                Object.freeze({
                    description: entry.description,
                    id: entry.id,
                    requiresSemanticProjectIndex: semanticIndexCodemodIdSet.has(entry.id)
                })
            )
        })
    });
}

export { createDocumentationCatalogs, type DocumentationCatalogProviders, loadLspToolsCatalogEntries };
