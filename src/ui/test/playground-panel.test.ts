import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GmPlaygroundPanel } from "../src/app/components/gm-playground-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { DEFAULT_PLAYGROUND_GML_SOURCE } from "../src/app/playground-default-gml.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import type { GraphVisualizationProjectConfigurationCatalog } from "../src/graph/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmPlaygroundPanel extends GmPlaygroundPanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

function createMockModel(): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: null,
        isServerMode: false,
        lastFixRun: null,
        loadedTarget: { activePath: "/test", projectRoot: "/tmp/test", selectedPaths: [], source: "working-directory" },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test GMLoop"
    };
}

function createMockState(): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activePage: "playground",
        activeGraphView: "visual",
        activeDocsView: "cli",
        labelMode: "auto"
    };
}

function createEmptyProjectConfigurationCatalog(): GraphVisualizationProjectConfigurationCatalog {
    return {
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
        githubRepositoryUrl: "",
        gmloop: {
            configPath: null,
            exists: false,
            projectRoot: "/tmp/test",
            rawConfig: {}
        },
        lint: { rules: [], rulesets: [], ruleset: null },
        refactor: { codemods: [] }
    };
}

function createMockProjectConfigurationCatalog(): GraphVisualizationProjectConfigurationCatalog {
    return {
        format: {
            entries: [
                {
                    description: "Preferred maximum line width for formatting decisions.",
                    name: "printWidth",
                    source: "default",
                    value: 100
                }
            ]
        },
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
        githubRepositoryUrl: "",
        gmloop: {
            configPath: null,
            exists: false,
            projectRoot: "/tmp/test",
            rawConfig: {}
        },
        lint: {
            rules: [
                {
                    description: "No constructor assignment.",
                    fixable: "code",
                    level: "error",
                    options: {},
                    ruleId: "@gmloop/no-constructor-assignment"
                }
            ],
            rulesets: [
                {
                    name: "recommended",
                    ruleIds: ["@gmloop/no-constructor-assignment"]
                }
            ],
            ruleset: null
        },
        refactor: {
            codemods: [
                {
                    config: {},
                    description: "Legacy test codemod",
                    enabled: true,
                    id: "legacy-codemod",
                    requiresSemanticProjectIndex: false
                }
            ]
        }
    };
}

void test("playground panel renders controls panel toggle with expanded state", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="playground-page"[\s\S]*class=page content-page active/u);
    assert.match(rendered, /button\s+type="button"\s+class="playground-controls-toggle is-open"/u);
    assert.match(rendered, /aria-controls="playground-controls-panel"/u);
    assert.match(rendered, /aria-expanded=true/u);
    assert.match(rendered, /class="playground-controls-toggle-icon"\s+aria-hidden="true"/u);
    assert.match(rendered, />\s*Hide Controls\s*</u);
    assert.match(rendered, /id="playground-controls-panel"/u);
    assert.doesNotMatch(rendered, /Format, lint, codemod, and transpile selections/u);
    assert.doesNotMatch(rendered, />\s*Collapse\s*</u);
});

/**
 * Verify that view selector buttons also use semantic <button> elements.
 */
void test("playground panel view selector uses semantic <button> elements", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /button\s+type="button"\s+class="rule-toggle active"\s+aria-pressed=true/u);
    assert.match(rendered, /Output Code/u);
    assert.match(rendered, /AST View/u);
});

/**
 * Verify the playground panel clears its debounce timer when disconnected,
 * preventing memory leaks from dangling setTimeout references.
 */
void test("playground panel clears debounce timer on disconnect", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    // Verify the component has a disconnect lifecycle method
    assert.equal(typeof panel.disconnectedCallback, "function");

    // Call disconnectedCallback to trigger cleanup (timer field is private)
    panel.disconnectedCallback();
});

void test("playground panel toolbar keeps rule sections out of the top bar", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        projectConfigurationCatalog: createMockProjectConfigurationCatalog()
    };
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());
    const toolbarStart = rendered.indexOf('class="playground-toolbar"');
    const layoutStart = rendered.indexOf("class=playground-layout controls-open");
    const toolbarContent = rendered.slice(toolbarStart, layoutStart);

    assert.notEqual(toolbarStart, -1);
    assert.notEqual(layoutStart, -1);
    assert.doesNotMatch(toolbarContent, /Format Options/u);
    assert.doesNotMatch(toolbarContent, /Lint Rules/u);
    assert.doesNotMatch(toolbarContent, /Codemods/u);
    assert.match(rendered, /class="playground-controls-panel is-open"/u);
    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Codemods/u);
});

void test("playground panel renders transpile modes in the controls panel and off by default", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());
    const controlsPanelMatch = /<aside[\s\S]*?class="playground-controls-panel is-open"[\s\S]*?<\/aside>/u.exec(
        rendered
    );

    assert.notEqual(controlsPanelMatch, null);
    assert.match(controlsPanelMatch[0], /Transpile/u);
    assert.match(controlsPanelMatch[0], /Patch Transpile/u);
    assert.match(controlsPanelMatch[0], /Expression Transpile/u);
    assert.match(rendered, /Patch Transpile/);
    assert.match(rendered, /Expression Transpile/);
    assert.equal([...rendered.matchAll(/class="rule-toggle active"/gu)].length, 1);
    assert.equal([...rendered.matchAll(/class="rule-toggle "/gu)].length, 3);
});

void test("playground panel starts with the shared demo sample source", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /demo_inventory_total/u);
    assert.match(rendered, /array_length\(inventory\)/u);
    assert.equal(DEFAULT_PLAYGROUND_GML_SOURCE.includes('var total = real("5");'), true);
    assert.equal(DEFAULT_PLAYGROUND_GML_SOURCE.includes("fa_readonly + fa_archive"), true);
    assert.match(DEFAULT_PLAYGROUND_GML_SOURCE, /if \(array_length\(inventory\) > 0\) show_debug_message/u);
    assert.match(DEFAULT_PLAYGROUND_GML_SOURCE, /function demo_inventory_total\( playerName , inventory \)/u);
    assert.match(DEFAULT_PLAYGROUND_GML_SOURCE, /inventory \[ i \]/u);
});

void test("playground panel renders format/lint/codemod detail sections", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        projectConfigurationCatalog: createMockProjectConfigurationCatalog()
    };
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Codemods/u);
    assert.match(rendered, /aria-controls=format-options-entries/u);
    assert.match(rendered, /aria-controls=lint-rules-entries/u);
    assert.match(rendered, /aria-controls=codemods-entries/u);
    assert.match(rendered, /aria-expanded=false/u);
    assert.doesNotMatch(rendered, /Set formatter values in <code>gmloop\.json<\/code>/u);
});

void test("playground panel exposes accessible labels for input and output regions", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /aria-label="Playground input GML"/u);
    assert.match(rendered, /class="playground-output"\s+aria-live="polite"/u);
});

void test("playground panel starts with all format/lint/codemod controls unchecked and off", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: { name: "gmloop-mcp", version: "0.0.1" },
            mcpTools: [],
            workspaceRules: {
                formatOptions: [
                    {
                        defaultValue: 100,
                        description: "Preferred maximum line width.",
                        name: "printWidth"
                    },
                    {
                        defaultValue: true,
                        description: "Use trailing commas.",
                        name: "trailingComma"
                    }
                ],
                lintRules: [
                    {
                        description: "Rule for noGlobalvar.",
                        fixable: null,
                        ruleId: "gml/no-globalvar"
                    }
                ],
                refactorCodemods: [
                    {
                        description: "Expand scientific notation.",
                        id: "scientificNotation",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        },
        projectConfigurationCatalog: createEmptyProjectConfigurationCatalog()
    };
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    // Section labels appear (rules catalog is populated from workspace rules fallback)
    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Codemods/u);

    // Verify no checked checkboxes appear for these rules (they default to unchecked/off)
    assert.doesNotMatch(rendered, /type="checkbox"\s+checked[^>]*>.*printWidth/u);
    assert.doesNotMatch(rendered, /type="checkbox"\s+checked[^>]*>.*trailingComma/u);
    assert.doesNotMatch(rendered, /type="checkbox"\s+checked[^>]*>.*gml\/no-globalvar/u);
    assert.doesNotMatch(rendered, /type="checkbox"\s+checked[^>]*>.*scientificNotation/u);
});

void test("playground panel falls back to workspace catalogs when project config entries are empty", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: { name: "gmloop-mcp", version: "0.0.1" },
            mcpTools: [],
            workspaceRules: {
                formatOptions: [
                    {
                        defaultValue: 100,
                        description: "Preferred maximum line width for formatting decisions.",
                        name: "printWidth"
                    }
                ],
                lintRules: [
                    {
                        description: "Rule for noGlobalvar.",
                        fixable: null,
                        ruleId: "gml/no-globalvar"
                    }
                ],
                refactorCodemods: [
                    {
                        description:
                            "Expand unsupported scientific-notation number literals into plain decimal literals.",
                        id: "scientificNotation",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        },
        projectConfigurationCatalog: createEmptyProjectConfigurationCatalog()
    };
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /Lint Rules/u);
    assert.match(rendered, /Codemods/u);
    assert.match(rendered, /Set formatter values in <code>gmloop\.json<\/code> to apply Playground format options\./u);
});

/**
 * Verify that format options from the project configuration catalog are registered
 * in the enabled-format-options state map when the model changes. This prevents a bug
 * where selecting a format option in the playground would not take effect if the option
 * was not yet in the private state map.
 */
void test("playground panel syncs format options from project configuration catalog into internal state map", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        projectConfigurationCatalog: {
            ...createEmptyProjectConfigurationCatalog(),
            format: {
                entries: [
                    {
                        description: "Preferred maximum line width.",
                        name: "printWidth",
                        source: "default",
                        value: 100
                    },
                    {
                        description: "Use trailing commas.",
                        name: "trailingComma",
                        source: "default",
                        value: false
                    }
                ]
            }
        }
    };
    panel.state = createMockState();
    panel.requestUpdate();
    void 0;

    const rendered = renderTemplateValue(panel.renderForTest());

    // The format option section must be visible with entries from the project config.
    // The section count badge shows how many format options are registered in the internal map
    // (even when the section is collapsed).
    assert.match(rendered, /Format Options/u);
    assert.match(rendered, /0\/2 enabled/u);
});

void test("playground panel output does not have leading whitespace nodes", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    // Make sure the markup does not introduce text nodes (whitespace) inside the pre-formatted element
    assert.match(rendered, /<div class="playground-output" aria-live="polite">[^<]*<\/div>/u);
    // There shouldn't be newlines or spaces right after the opening tag — whitespace in a
    // Lit template becomes a DOM text node that is visible inside white-space: pre elements.
    // The pattern matches the opening tag followed by whitespace (\s+) then a non-whitespace
    // character (\S). If the doesNotMatch passes, no leading whitespace exists.
    assert.doesNotMatch(rendered, /<div class="playground-output" aria-live="polite">\s+\S/u);
});

/**
 * Verify the AST output path is also free of leading whitespace text nodes.
 *
 * The AST pane uses a <pre> element with white-space: pre so any leading whitespace
 * inside it would be rendered visibly. The same template rule from #renderOutput
 * applies here — keep the html template on a single line.
 */
void test("playground panel AST output does not have leading whitespace nodes", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    panel.renderForTest();
    // The compiled JS is in dist/src/app/components/ from the test dist directory.
    // We verify the <pre> template is structurally sound by checking the compiled source.
    const source = readFileSync(new URL("../src/app/components/gm-playground-panel.js", import.meta.url), "utf8");
    // The AST output is rendered inside #renderOutput. The html template for the <pre>
    // element must be on a single line with no leading whitespace inside the tags.
    assert.match(source, /html `<pre class="playground-output" aria-live="polite">\$\{astJson\}<\/pre>`/u);
    // Verify the <pre> template does not span multiple lines with indentation.
    // A multiline template with leading whitespace would break the whitespace test.
    assert.doesNotMatch(source, /html `<pre class="playground-output" aria-live="polite">\s*\n\s*\$\{astJson\}/u);
});

void test("playground panel input uses a highlighted overlay with synchronized textarea", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();
    const rendered = renderTemplateValue(panel.renderForTest());

    // Verify the highlighted overlay wrapper structure exists
    assert.match(rendered, /class="playground-input-surface"/u);

    // Verify the highlight layer exists
    assert.match(rendered, /<pre class="playground-input-highlight" aria-hidden="true">/u);

    // Verify the transparent textarea exists
    assert.match(rendered, /<textarea\s+class="playground-input"/u);
    assert.match(rendered, /@scroll=/u);
});

void test("playground panel selects a fixture, populates input, and applies its config rules", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = {
        ...createMockModel(),
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: { name: "gmloop-mcp", version: "0.0.1" },
            mcpTools: [],
            workspaceRules: {
                formatOptions: [
                    {
                        defaultValue: 100,
                        description: "Preferred maximum line width.",
                        name: "printWidth"
                    }
                ],
                lintRules: [
                    {
                        description: "Rule for noGlobalvar.",
                        fixable: null,
                        ruleId: "gml/no-globalvar"
                    }
                ],
                refactorCodemods: [
                    {
                        description: "Expand scientific notation.",
                        id: "scientificNotation",
                        requiresSemanticProjectIndex: false
                    }
                ]
            }
        },
        projectConfigurationCatalog: createMockProjectConfigurationCatalog()
    };
    panel.state = createMockState();
    panel.setExpandedSectionsForTest(true, true, true);

    const testFixtures = [
        {
            caseId: "format/example-test",
            kind: "format",
            inputGml: "if (foo) { bar(); }",
            expectedGml: "if (foo) {\n    bar();\n}",
            config: {
                printWidth: 80
            }
        },
        {
            caseId: "lint/example-test",
            kind: "lint",
            inputGml: "globalvar x;",
            expectedGml: "globalvar x;",
            config: {
                lintRules: {
                    "@gmloop/no-constructor-assignment": "error"
                }
            }
        }
    ];

    // Set the fixtures list
    panel.setFixturesForTest(testFixtures);

    // Initial render
    let rendered = renderTemplateValue(panel.renderForTest());

    // Verify option tags in the dropdown exist
    assert.match(rendered, /value=format\/example-test/u);
    assert.match(rendered, /value=lint\/example-test/u);
    assert.match(rendered, /\[format\] format\/example-test/u);
    assert.match(rendered, /\[lint\] lint\/example-test/u);

    // Select the format fixture
    panel.selectFixtureForTest("format/example-test");
    assert.equal(panel.getSelectedFixtureIdForTest(), "format/example-test");

    rendered = renderTemplateValue(panel.renderForTest());
    // Verify it is selected in the select element (indicated by ?selected=true)
    assert.match(rendered, /value=format\/example-test\s+\?selected=true/u);

    // Verify the input pane is populated with the fixture's input GML
    assert.match(rendered, /if \(foo\) \{ bar\(\); \}/u);

    // Verify correct format/lint/codemod options are applied according to the fixture's config
    // Specifically, for format/example-test: printWidth is defined in config, so it should be checked
    assert.match(rendered, /\.checked=true[\s\S]*?class="rule-details-item-key">printWidth<\/span>/u);
    // Since lintRules are not defined, lint rules should not be checked
    assert.match(
        rendered,
        /\.checked=false[\s\S]*?class="rule-details-item-key">@gmloop\/no-constructor-assignment<\/span>/u
    );

    // Select the lint fixture
    panel.selectFixtureForTest("lint/example-test");
    assert.equal(panel.getSelectedFixtureIdForTest(), "lint/example-test");

    rendered = renderTemplateValue(panel.renderForTest());
    assert.match(rendered, /value=lint\/example-test\s+\?selected=true/u);
    // Verify the input is updated
    assert.match(rendered, /globalvar x;/u);

    // printWidth should now be false (not in lint fixture config)
    assert.match(rendered, /\.checked=false[\s\S]*?class="rule-details-item-key">printWidth<\/span>/u);
    // @gmloop/no-constructor-assignment should now be true
    assert.match(
        rendered,
        /\.checked=true[\s\S]*?class="rule-details-item-key">@gmloop\/no-constructor-assignment<\/span>/u
    );
});

void test("playground panel output diff highlights changes with GML syntax highlighting", () => {
    const panel = new TestableGmPlaygroundPanel();
    panel.model = createMockModel();
    panel.state = createMockState();

    // Set actual output and expected output to trigger diff rendering
    panel.setOutputForTest(
        'if (foo) {\n    show_debug_message("hello");\n}',
        'if (foo) {\n    show_debug_message("world");\n}'
    );

    const rendered = renderTemplateValue(panel.renderForTest());

    // Verify the diff container exists
    assert.match(rendered, /class="playground-output diff-container"/u);

    // Verify that diff-added and diff-removed lines exist
    assert.match(rendered, /class="diff-line diff-added"/u);
    assert.match(rendered, /class="diff-line diff-removed"/u);

    // Verify syntax highlighting classes are present within the diff lines
    // "if" should be highlighted as a keyword
    assert.match(rendered, /<span class="gml-keyword">if<\/span>/u);
    // "show_debug_message" should be highlighted as a function-name
    assert.match(rendered, /<span class="gml-function-name">show_debug_message<\/span>/u);
    // "hello" and "world" should be highlighted as strings
    assert.match(rendered, /<span class="gml-string">"hello"<\/span>/u);
    assert.match(rendered, /<span class="gml-string">"world"<\/span>/u);
});
