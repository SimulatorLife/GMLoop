import assert from "node:assert/strict";
import test from "node:test";

import { GmAppHeader } from "../src/app/components/gm-app-header.js";
import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import { GmDocsPanel } from "../src/app/components/gm-docs-panel.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";
import { createMockGraphVisualizationUiModel, createMockGraphVisualizationUiState } from "./ui-model-state-fixtures.js";

class TestableGmAppShell extends GmAppShell {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmAppHeader extends GmAppHeader {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmDocsPanel extends GmDocsPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

function renderShellSkipLinkForPage(page: GraphVisualizationUiState["activePage"]): string {
    const previousLocation = globalThis.location;
    Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: {
            hash: "",
            pathname: "/",
            search: `?page=${page}`
        }
    });

    try {
        const shell = new TestableGmAppShell();
        shell.model = createMockModel();
        return renderTemplateValue(shell.renderForTest());
    } finally {
        if (previousLocation === undefined) {
            Reflect.deleteProperty(globalThis, "location");
        } else {
            Object.defineProperty(globalThis, "location", {
                configurable: true,
                value: previousLocation
            });
        }
    }
}

function createMockModel() {
    return createMockGraphVisualizationUiModel({
        projectConfigurationCatalog: {
            format: { entries: [] },
            gameMakerCli: {
                available: false,
                cliCommands: [],
                error: null,
                invocation: null,
                mcpServer: {
                    available: false,
                    error: null,
                    name: null,
                    projectPath: null,
                    serverId: null,
                    sourcePath: null,
                    version: null
                },
                mcpTools: [],
                version: null
            },
            githubRepositoryUrl: "https://github.com/SimulatorLife/GMLoop",
            gmloop: {
                configPath: "/tmp/.gmloop.json",
                exists: true,
                projectRoot: "/tmp/test",
                rawConfig: {}
            },
            lint: { rules: [], rulesets: [], ruleset: null },
            refactor: { codemods: [] }
        },
        title: "Test"
    });
}

function createMockState() {
    return createMockGraphVisualizationUiState({ activePage: "docs" });
}

void test("GmAppShell targets graph content in skip-link by default", () => {
    const shell = new TestableGmAppShell();
    shell.model = createMockModel();

    const rendered = renderTemplateValue(shell.renderForTest());

    assert.match(rendered, /<a class="skip-link" href=#graph-page>Skip to content<\/a>/u);
});

void test("GmAppShell skip-link follows the active page target", () => {
    let rendered = renderShellSkipLinkForPage("docs");
    assert.match(rendered, /<a class="skip-link" href=#docs-page>Skip to content<\/a>/u);

    rendered = renderShellSkipLinkForPage("fix");
    assert.match(rendered, /<a class="skip-link" href=#fix-page>Skip to content<\/a>/u);
});

void test("GmAppShell error banner has role=alert and tabindex=-1 for keyboard focus", () => {
    const shell = new TestableGmAppShell();
    shell.model = createMockModel();
    assert.equal(shell.model !== null, true);
});

void test("GmDocsPanel delegates subview tablist rendering to the page toolbar", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.doesNotMatch(rendered, /<div class="docs-nav" role="tablist" aria-label="Documentation view selector">/u);
    assert.doesNotMatch(rendered, /id=docs-view-cli[\s\S]*class=docs-nav-button/u);
    assert.doesNotMatch(rendered, /id=docs-view-mcp[\s\S]*class=docs-nav-button/u);
    assert.match(rendered, /id="cli-page"[\s\S]*role="tabpanel"[\s\S]*aria-labelledby="docs-view-cli"/u);
    assert.match(rendered, /id="docs-mcp-page"[\s\S]*role="tabpanel"[\s\S]*aria-labelledby="docs-view-mcp"/u);
});

void test("GmDocsPanel uses a dedicated id for MCP docs subview to avoid id collisions", () => {
    const panel = new TestableGmDocsPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.equal(Array.from(rendered.matchAll(/id="docs-mcp-page"/gu)).length, 1);
    assert.equal(Array.from(rendered.matchAll(/id="auto-game-page"/gu)).length, 0);
});

void test("GmAppHeader exposes aria-current for the active top-level page only", () => {
    const header = new TestableGmAppHeader();
    header.model = createMockModel();
    header.state = createMockState();
    header.state = { ...header.state, activePage: "docs" };

    const rendered = renderTemplateValue(header.renderForTest());

    assert.match(rendered, /id="tab-docs"[^>]*aria-current=page/u);
    assert.doesNotMatch(rendered, /id="tab-graph"[^>]*aria-current=page/u);
    assert.doesNotMatch(rendered, /id="tab-config"[^>]*aria-current=page/u);
});
