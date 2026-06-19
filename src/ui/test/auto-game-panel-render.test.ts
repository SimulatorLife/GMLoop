import assert from "node:assert/strict";
import test from "node:test";

import type { PropertyValues } from "lit";

import {
    GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK,
    GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED,
    GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_PIPELINE,
    GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_TASK
} from "../src/app/components/events.js";
import { GmAppShell } from "../src/app/components/gm-app-shell.js";
import { GmAutoGamePanel } from "../src/app/components/gm-auto-game-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmAutoGamePanel extends GmAutoGamePanel {
    public renderForTest(): unknown {
        return this.render();
    }
}

class TestableGmAppShell extends GmAppShell {
    protected override update(_changedProperties: PropertyValues<this>): void {}
}

function createMockModel(overrides?: Partial<GraphVisualizationUiModel>): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [],
            projectRoot: "/tmp/test"
        },
        documentationCatalogs: {
            cliCommands: [],
            mcpServer: {
                name: "gmloop-mcp",
                version: "0.2.0"
            },
            mcpTools: [
                {
                    commandDisplayName: "Graph Visualize",
                    description: "Builds graph visualization assets.",
                    fields: [
                        {
                            attributeName: "path",
                            choices: [],
                            description: "Path to project",
                            kind: "argument",
                            multiple: false,
                            name: "path",
                            required: true,
                            valueType: "string"
                        }
                    ],
                    toolName: "graph.visualize"
                },
                {
                    commandDisplayName: "Lint Project",
                    description: "Runs lint rules against a project.",
                    fields: [],
                    toolName: "lint.project"
                }
            ],
            workspaceRules: {
                formatOptions: [],
                lintRules: [],
                refactorCodemods: []
            }
        },
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: null,
        liveReload: null,
        mcpServerStatus: "running",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Auto-Game",
        ...overrides
    };
}

function createMockState(overrides?: Partial<GraphVisualizationUiState>): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeConfigView: "rendered",
        activeDocsView: "cli",
        activeGraphView: "visual",
        activePage: "auto-game",
        labelMode: "auto",
        mcpServerStatus: "running",
        ...overrides
    };
}

void test("GmAutoGamePanel renders empty pipeline slots and MCP bridge metadata", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({ isServerMode: false });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="auto-game-page"[\s\S]*class=page content-page active/u);
    assert.match(rendered, /id="auto-game-content"[\s\S]*class="auto-game-dashboard"/u);
    assert.match(rendered, /class="auto-game-primary-grid"[\s\S]*Pipeline Controls[\s\S]*AI Skills/u);
    assert.match(rendered, /class="auto-game-secondary-grid"[\s\S]*Pipeline Feed[\s\S]*LLM Output/u);
    assert.match(rendered, /class="auto-game-supporting"[\s\S]*MCP Bridge/u);
    assert.doesNotMatch(rendered, /id="auto-game-meta"/u);
    assert.match(rendered, /Pipeline Controls/u);
    assert.match(rendered, /id="start-auto-game-pipeline"[\s\S]*class="gm-btn gm-btn--primary"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /id="pause-auto-game-pipeline"[\s\S]*\?disabled=true/u);
    assert.match(
        rendered,
        /id="stop-auto-game-pipeline"[\s\S]*class="gm-btn gm-btn--destructive"[\s\S]*\?disabled=true/u
    );
    assert.match(rendered, /id="auto-game-task-prompt"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /class="gm-empty auto-game-empty--compact"[\s\S]*role="status"/u);
    assert.match(rendered, /No auto-game pipeline controller is connected/u);
    assert.match(rendered, /Pipeline Feed/u);
    assert.match(rendered, /\.gmloop\/agent-log\.jsonl/u);
    assert.match(rendered, /AI Skills/u);
    assert.match(rendered, /Open a GameMaker project to discover its Auto-Game skills/u);
    assert.doesNotMatch(rendered, /initialize-auto-game-agent-pack/u);
    assert.match(rendered, /LLM Output/u);
    assert.match(rendered, /MCP Bridge/u);
    assert.match(rendered, /gmloop-mcp/u);
    assert.match(rendered, /0\.2\.0/u);
    assert.match(rendered, /MCP lifecycle events/u);
});

void test("GmAutoGamePanel renders host-provided pipeline details", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [
                {
                    description: "Create a playable vertical slice.",
                    disabled: false,
                    id: "start",
                    label: "Start Pipeline"
                }
            ],
            agentPack: {
                availableVersion: "0.0.1",
                conflicts: [],
                installedVersion: "0.0.1",
                resources: [
                    {
                        content: "# Autonomous Game Development Guidance\n\nIterate on a playable outcome.\n",
                        kind: "template",
                        packagePath: "templates/project-agents.md",
                        targetPath: "AGENTS.md"
                    },
                    {
                        content: "---\nname: gmloop-game-development-loop\n---\n",
                        kind: "skill",
                        packagePath: "skills/gmloop-game-development-loop/SKILL.md",
                        targetPath: ".agents/skills/gmloop-game-development-loop/SKILL.md"
                    }
                ],
                status: "current"
            },
            events: [
                {
                    detail: "Defined core loop and player verbs.",
                    id: "event-1",
                    status: "success",
                    timestamp: "2026-01-01T00:00:00.000Z",
                    title: "Design pass complete"
                }
            ],
            llmOutputs: [
                {
                    content: "Keep the first playable slice small.",
                    id: "llm-1",
                    role: "thought",
                    timestamp: "2026-01-01T00:00:01.000Z",
                    title: "Scope note"
                }
            ],
            skills: [
                {
                    description: "Defines core loop and playable-slice constraints.",
                    diagnostic: null,
                    enabled: true,
                    id: "game-design",
                    name: "game-design",
                    sourcePath: ".agents/skills/game-design/SKILL.md",
                    status: "available"
                },
                {
                    description: "GMLoop could not read this skill's display metadata.",
                    diagnostic: "Could not parse SKILL.md frontmatter.",
                    enabled: true,
                    id: "project-notes",
                    name: "project-notes",
                    sourcePath: ".agents/skills/project-notes/SKILL.md",
                    status: "unreadable"
                }
            ],
            status: "running",
            statusText: "Creating the first playable slice."
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Start Pipeline/u);
    assert.match(rendered, /Design pass complete/u);
    assert.match(rendered, /<gm-badge[\s\S]*\.label=Success[\s\S]*\.tone=success/u);
    assert.match(rendered, /<time[\s\S]*datetime=2026-01-01T00:00:00.000Z/u);
    assert.match(rendered, /game-design/u);
    assert.match(rendered, /class="auto-game-skill-disclosure"[\s\S]*?open/u);
    assert.match(rendered, /<summary>[\s\S]*Packaged Skills & Guidance Templates/u);
    assert.match(rendered, /Exclude game-design from Auto-Game/u);
    assert.match(rendered, /class="auto-game-skill-toggle__track"/u);
    assert.match(rendered, /\.label=Skill \(Detected\)[\s\S]*\.tone=success/u);
    assert.match(rendered, /Exclude project-notes from Auto-Game/u);
    assert.match(rendered, /\.label=Skill \(Unreadable\)[\s\S]*\.tone=error/u);
    assert.match(rendered, /Could not parse SKILL\.md frontmatter\./u);
    assert.match(rendered, /auto-game-skill-item--unreadable/u);
    assert.match(rendered, /\.agents\/skills\/game-design\/SKILL\.md/u);
    assert.match(rendered, /Scope note/u);
    assert.match(rendered, /<gm-badge[\s\S]*\.label=thought/u);
    assert.match(rendered, /<time[\s\S]*datetime=2026-01-01T00:00:01.000Z/u);
    assert.match(rendered, /Keep the first playable slice small\./u);
    assert.match(rendered, /AGENTS\.md/u);
    assert.match(rendered, /templates\/project-agents\.md/u);
    assert.match(rendered, /AGENTS\.md packaged source preview/u);
    assert.match(rendered, /# Autonomous Game Development Guidance/u);
    assert.match(rendered, /\.agents\/skills\/gmloop-game-development-loop\/SKILL\.md/u);
    assert.match(rendered, /Update \/ Re-sync Agent Pack/u);
    assert.match(rendered, /\.label=Up to Date[\s\S]*\.tone=success/u);
    assert.match(rendered, /id="initialize-auto-game-agent-pack"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /id="start-auto-game-pipeline"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /id="pause-auto-game-pipeline"[\s\S]*\?disabled=false/u);
    assert.match(rendered, /id="stop-auto-game-pipeline"[\s\S]*\?disabled=false/u);
    assert.match(rendered, /id="auto-game-task-prompt"[\s\S]*\?disabled=false/u);
});

void test("GmAutoGamePanel offers initialization for an empty loaded GameMaker project", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [],
            agentPack: {
                availableVersion: "0.0.1",
                conflicts: [],
                installedVersion: null,
                resources: [],
                status: "not-installed"
            },
            events: [],
            llmOutputs: [],
            skills: [],
            status: "idle",
            statusText: "No project-scoped Auto-Game skills are installed."
        },
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /No Auto-Game skills or templates are available\./u);
    assert.match(rendered, /Initialize GMLoop's Auto-Game Agent Pack/u);
    assert.match(rendered, /\.label=Not Initialized[\s\S]*\.tone=warning/u);
    assert.match(rendered, /Update Project \.gitignore/u);
    assert.match(rendered, /type="checkbox"[\s\S]*\.checked=true/u);
    assert.match(rendered, /id="initialize-auto-game-agent-pack"[\s\S]*\?disabled=false/u);
});

void test("GmAutoGamePanel disables initialization and shows the shared spinner while it is pending", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [],
            agentPack: {
                availableVersion: "0.0.2",
                conflicts: [],
                installedVersion: null,
                resources: [],
                status: "not-installed"
            },
            events: [],
            llmOutputs: [],
            skills: [],
            status: "idle",
            statusText: "No project-scoped Auto-Game skills are installed."
        },
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    panel.state = createMockState({ autoGamePendingOperation: "initialize-agent-pack" });

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="initialize-auto-game-agent-pack"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /id="initialize-auto-game-agent-pack"[\s\S]*aria-busy=true/u);
    assert.match(rendered, /id="initialize-auto-game-agent-pack"[\s\S]*class="button-spinner"/u);
    assert.match(rendered, /id="initialize-auto-game-agent-pack"[\s\S]*Initialize Auto-Game Agent Pack/u);
    assert.match(rendered, /type="checkbox"[\s\S]*\?disabled=true/u);
});

void test("GmAutoGamePanel disables concurrent controls and preserves lifecycle labels while pending", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel();
    panel.state = createMockState({ autoGamePendingOperation: "pipeline-start" });

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="start-auto-game-pipeline"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /id="start-auto-game-pipeline"[\s\S]*aria-busy=true/u);
    assert.match(rendered, /id="start-auto-game-pipeline"[\s\S]*class="button-spinner"/u);
    assert.match(rendered, /id="start-auto-game-pipeline"[\s\S]*Start/u);
    assert.match(rendered, /id="pause-auto-game-pipeline"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /id="stop-auto-game-pipeline"[\s\S]*\?disabled=true/u);
    assert.match(rendered, /id="run-auto-game-task"[\s\S]*\?disabled=true/u);
});

void test("GmAutoGamePanel presents detected skills without a receipt as incomplete setup", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [],
            agentPack: {
                availableVersion: "0.0.1",
                conflicts: [],
                installedVersion: null,
                resources: [],
                status: "not-installed"
            },
            events: [],
            llmOutputs: [],
            skills: [
                {
                    description: "Design the game.",
                    diagnostic: null,
                    enabled: true,
                    id: "game-design",
                    name: "game-design",
                    sourcePath: ".agents/skills/game-design/SKILL.md",
                    status: "available"
                }
            ],
            status: "idle",
            statusText: "1 of 1 Auto-Game skills enabled."
        },
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /\.label=Setup Incomplete[\s\S]*\.tone=warning/u);
    assert.match(rendered, /1 project skill was detected, but this project has no agent-pack installation record/u);
    assert.match(rendered, /Complete setup to synchronize GMLoop's packaged resources and record their version/u);
    assert.match(rendered, /Complete Auto-Game Setup/u);
    assert.match(rendered, /\.label=Skill \(Detected\)[\s\S]*\.tone=success/u);
    assert.match(rendered, />Included</u);
    assert.match(rendered, /Exclude game-design from Auto-Game/u);
    assert.doesNotMatch(rendered, /\.label=Available/u);
    assert.doesNotMatch(rendered, />Enabled</u);
    assert.doesNotMatch(rendered, /\.label=Not Initialized/u);
});

void test("GmAutoGamePanel offers an agent-pack update while retaining discovered skills", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [],
            agentPack: {
                availableVersion: "0.0.2",
                conflicts: [],
                installedVersion: "0.0.1",
                resources: [],
                status: "update-available"
            },
            events: [],
            llmOutputs: [],
            skills: [
                {
                    description: "Design the game.",
                    diagnostic: null,
                    enabled: true,
                    id: "game-design",
                    name: "game-design",
                    sourcePath: ".agents/skills/game-design/SKILL.md",
                    status: "available"
                }
            ],
            status: "idle",
            statusText: "1 of 1 Auto-Game skills enabled."
        },
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Auto-Game Agent Pack 0\.0\.2 is available/u);
    assert.match(rendered, /Update Auto-Game Agent Pack/u);
    assert.match(rendered, /game-design/u);
});

void test("GmAutoGamePanel offers a re-sync option when the agent-pack is up to date and project is loaded", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [],
            agentPack: {
                availableVersion: "0.0.1",
                conflicts: [],
                installedVersion: "0.0.1",
                resources: [],
                status: "current"
            },
            events: [],
            llmOutputs: [],
            skills: [],
            status: "idle",
            statusText: "All skills up to date."
        },
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /This project is synchronized with GMLoop's latest packaged skills/u);
    assert.match(rendered, /Update \/ Re-sync Agent Pack/u);
    assert.match(rendered, /\.label=Up to Date[\s\S]*\.tone=success/u);
    assert.match(rendered, /id="initialize-auto-game-agent-pack"[\s\S]*\?disabled=false/u);
});

void test("GmAutoGamePanel presents preserved agent-pack conflicts as an actionable status", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        autoGamePipeline: {
            actions: [],
            agentPack: {
                availableVersion: "0.0.2",
                conflicts: ["skills/game-design/SKILL.md"],
                installedVersion: "0.0.1",
                resources: [],
                status: "update-available"
            },
            events: [],
            llmOutputs: [],
            skills: [],
            status: "blocked",
            statusText: "Resolve preserved project changes before continuing."
        },
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /class="auto-game-skill-item__diagnostic auto-game-conflict-notice"[\s\S]*role="status"/u);
    assert.match(rendered, /Preserved project-modified agent-pack files: skills\/game-design\/SKILL\.md/u);
});

void test("GmAutoGamePanel renders without server metadata when documentationCatalogs is null", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({ documentationCatalogs: null });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="auto-game-page"[\s\S]*class=page content-page active/u);
    assert.match(rendered, /MCP Bridge/u);
    assert.doesNotMatch(rendered, /gmloop-mcp/u);
});

void test("GmAutoGamePanel renders inactive page class when not on Auto-Game page", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel();
    panel.state = createMockState({ activePage: "graph" });

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /id="auto-game-page"[\s\S]*class=page content-page/u);
    assert.doesNotMatch(rendered, /class=page content-page active/u);
});

void test("GmAppShell routes auto-game lifecycle events through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let startCount = 0;
    shell.model = createMockModel();
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => null,
        onStopLiveReload: () => {},
        onStartAutoGamePipeline: () => {
            startCount += 1;
            return {
                actions: [],
                agentPack: {
                    availableVersion: "0.0.1",
                    conflicts: [],
                    installedVersion: "0.0.1",
                    resources: [],
                    status: "current"
                },
                events: [],
                llmOutputs: [],
                skills: [],
                status: "running",
                statusText: "Creating the game."
            };
        }
    };

    shell.connectedCallback();
    shell.dispatchEvent(
        new CustomEvent(GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_PIPELINE, {
            bubbles: true,
            detail: { action: "start" }
        })
    );
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(startCount, 1);
    assert.equal(shell.model?.autoGamePipeline?.status, "running");
});

void test("GmAppShell routes auto-game one-time tasks through the host callback", async () => {
    const shell = new TestableGmAppShell();
    let receivedPrompt = "";
    shell.model = createMockModel();
    shell.callbacks = {
        onOpenProject: () => {},
        onRegenerate: () => {},
        onSaveConfig: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onStartLiveReload: () => null,
        onStopLiveReload: () => {},
        onRunAutoGameTask: (prompt) => {
            receivedPrompt = prompt;
            return null;
        }
    };

    shell.connectedCallback();
    shell.dispatchEvent(
        new CustomEvent(GRAPH_UI_EVENT_TRIGGER_AUTO_GAME_TASK, {
            bubbles: true,
            detail: { prompt: "  add player movement  " }
        })
    );
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(receivedPrompt, "add player movement");
});

void test("GmAppShell routes agent-pack initialization and skill toggles through host callbacks", async () => {
    const shell = new TestableGmAppShell();
    let initialized = 0;
    let initializationOptions: Readonly<{ includeGitIgnore: boolean }> | null = null;
    let toggled: Readonly<{ enabled: boolean; name: string }> | null = null;
    shell.model = createMockModel({
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    shell.callbacks = {
        onInitializeAutoGameAgentPack: (options) => {
            initialized += 1;
            initializationOptions = options;
        },
        onOpenProject: () => {},
        onRegenerate: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onSaveConfig: () => {},
        onSetAutoGameSkillEnabled: (name, enabled) => {
            toggled = { enabled, name };
        },
        onStartLiveReload: () => null,
        onStopLiveReload: () => {}
    };

    shell.connectedCallback();
    shell.dispatchEvent(
        new CustomEvent(GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK, {
            bubbles: true,
            detail: { includeGitIgnore: false }
        })
    );
    await Promise.resolve();
    shell.dispatchEvent(
        new CustomEvent(GRAPH_UI_EVENT_SET_AUTO_GAME_SKILL_ENABLED, {
            bubbles: true,
            detail: { enabled: false, name: "game-design" }
        })
    );
    await Promise.resolve();
    shell.disconnectedCallback();

    assert.equal(initialized, 1);
    assert.deepEqual(initializationOptions, { includeGitIgnore: false });
    assert.deepEqual(toggled, { enabled: false, name: "game-design" });
});

void test("GmAppShell rejects duplicate agent-pack initialization events while the first is pending", async () => {
    const shell = new TestableGmAppShell();
    let resolveInitialization = (): void => {
        throw new Error("Initialization promise resolver was not assigned.");
    };
    const initialization = new Promise<void>((resolve) => {
        resolveInitialization = resolve;
    });
    let initializationCount = 0;
    shell.model = createMockModel({
        loadedTarget: {
            activePath: "/tmp/test/Test.yyp",
            projectRoot: "/tmp/test",
            selectedPaths: ["/tmp/test/Test.yyp"],
            source: "cli-path"
        }
    });
    shell.callbacks = {
        onInitializeAutoGameAgentPack: () => {
            initializationCount += 1;
            return initialization;
        },
        onOpenProject: () => {},
        onRegenerate: () => {},
        onRunFix: () => ({ logLines: [], status: "success" }),
        onSaveConfig: () => {},
        onStartLiveReload: () => null,
        onStopLiveReload: () => {}
    };

    shell.connectedCallback();
    const initializeEvent = () =>
        new CustomEvent(GRAPH_UI_EVENT_INITIALIZE_AUTO_GAME_AGENT_PACK, {
            bubbles: true,
            detail: { includeGitIgnore: true }
        });
    shell.dispatchEvent(initializeEvent());
    shell.dispatchEvent(initializeEvent());
    await Promise.resolve();

    assert.equal(initializationCount, 1);

    resolveInitialization();
    await initialization;
    await Promise.resolve();
    shell.disconnectedCallback();
});

void test("GmAutoGamePanel renders agent-pack resources even when no project is loaded", () => {
    const panel = new TestableGmAutoGamePanel();
    panel.model = createMockModel({
        loadedTarget: null,
        autoGamePipeline: {
            actions: [],
            agentPack: {
                availableVersion: "0.0.1",
                conflicts: [],
                installedVersion: null,
                resources: [
                    {
                        content: "# Autonomous Game Guidance",
                        kind: "template",
                        packagePath: "templates/project-agents.md",
                        targetPath: "AGENTS.md"
                    }
                ],
                status: "not-installed"
            },
            events: [],
            llmOutputs: [],
            skills: [],
            status: "idle",
            statusText: null
        }
    });
    panel.state = createMockState();

    const rendered = renderTemplateValue(panel.renderForTest());

    assert.match(rendered, /Packaged Skills & Guidance Templates/u);
    assert.match(rendered, /AGENTS\.md/u);
    assert.match(rendered, /templates\/project-agents\.md/u);
    assert.match(rendered, /# Autonomous Game Guidance/u);
    assert.match(rendered, /Open a GameMaker project to discover its Auto-Game skills\./u);
});
