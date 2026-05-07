import assert from "node:assert/strict";
import test from "node:test";

import type { TemplateResult } from "lit";

import { GmDocsPanel } from "../src/app/components/gm-docs-panel.js";
import type { GraphVisualizationDocumentationCatalogs } from "../src/graph/types.js";

class TestableGmDocsPanel extends GmDocsPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

function isTemplateResult(value: unknown): value is TemplateResult {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}

function renderTemplateValue(value: unknown): string {
    if (Array.isArray(value)) {
        return value.map((entry) => renderTemplateValue(entry)).join("");
    }

    if (isTemplateResult(value)) {
        let output = "";
        for (const [index, stringPart] of value.strings.entries()) {
            output += stringPart;
            if (index < value.values.length) {
                output += renderTemplateValue(value.values[index]);
            }
        }
        return output;
    }

    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    return JSON.stringify(value) ?? "";
}

function createDocumentationCatalogs(): GraphVisualizationDocumentationCatalogs {
    return {
        cliCommands: [],
        mcpServer: {
            name: "gmloop-mcp",
            version: "0.0.1"
        },
        mcpTools: [],
        workspaceRules: {
            formatOptions: [
                {
                    defaultValue: 100,
                    description: "Preferred print width.",
                    name: "printWidth"
                }
            ],
            lintRules: [
                {
                    description: "Normalize legacy operator aliases.",
                    fixable: "code",
                    ruleId: "gml/normalize-operators"
                }
            ],
            refactorCodemods: [
                {
                    description: "Rename globalvar references.",
                    id: "refactor/globalvar-to-global",
                    requiresSemanticProjectIndex: true
                }
            ]
        }
    };
}

void test("GmDocsPanel renders the Rules subview and workspace rule catalog content", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: createDocumentationCatalogs(),
        isServerMode: false,
        loadedTarget: null,
        projectConfigurationCatalog: null,
        title: "Rules Catalog"
    };
    panel.state = {
        activeDocsView: "rules",
        activeGraphView: "visual",
        activePage: "docs",
        errorMessage: null,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        searchQuery: ""
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /docs-view-rules/u);
    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Refactor Codemods/u);
    assert.match(rendered, /printWidth/u);
    assert.match(rendered, /gml\/normalize-operators/u);
    assert.match(rendered, /refactor\/globalvar-to-global/u);
});

void test("GmDocsPanel renders an empty rules state when workspace rule catalogs are missing", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = {
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: null,
        isServerMode: false,
        loadedTarget: null,
        projectConfigurationCatalog: null,
        title: "Rules Empty State"
    };
    panel.state = {
        activeDocsView: "rules",
        activeGraphView: "visual",
        activePage: "docs",
        errorMessage: null,
        isOpenProjectPending: false,
        isRegeneratePending: false,
        labelMode: "auto",
        searchQuery: ""
    };

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /docs-view-rules/u);
    assert.match(rendered, /No workspace rule catalog entries were provided by the host\./u);
});
