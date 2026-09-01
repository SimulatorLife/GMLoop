import { GmGraphPanel } from "../src/app/components/gm-graph-panel.js";
import type { GraphVisualizationUiModel } from "../src/app/contracts.js";
import { createInitialGraphVisualizationUiState } from "../src/app/state/reducer.js";
import type { GraphVisualizationUiState } from "../src/app/state/types.js";
import type { GraphLegendNodeKind } from "../src/graph/graph-layout.js";

/**
 * Test-only subclass of {@link GmGraphPanel} that exposes the otherwise protected
 * `render`, `selectNode`, and `toggleNodeKind` methods so individual tests can drive
 * the panel without relying on user-event plumbing.
 */
export class TestableGmGraphPanel extends GmGraphPanel {
    public renderForTest(): unknown {
        return this.render();
    }

    public selectNodeForTest(nodeId: string): void {
        this.selectNode(nodeId);
    }

    public toggleNodeKindForTest(kind: GraphLegendNodeKind): void {
        this.toggleNodeKind(kind);
    }
}

/**
 * Builds a {@link GraphVisualizationUiModel} populated with two nodes (a script and an
 * object) and a single `references` edge. The fixture is intentionally stable so
 * graph panel tests can assert against known node ids and SVG marker ids.
 */
export function createGraphModel(): GraphVisualizationUiModel {
    return {
        autoGamePipeline: null,
        data: {
            edges: [
                {
                    source: "script-node",
                    target: "object-node",
                    type: "references"
                }
            ],
            generatedAt: "2026-01-01T00:00:00.000Z",
            graphs: [],
            nodes: [
                {
                    displayName: "configure_globals",
                    filePath: "scripts/configure_globals/configure_globals.gml",
                    graphId: "project",
                    id: "script-node",
                    kind: "script",
                    lineEnd: 14,
                    lineStart: 10,
                    name: "configure_globals",
                    resourcePath: "scripts/configure_globals/configure_globals.yy",
                    scopeId: "project/scripts/configure_globals",
                    scipSymbol: "gml/script/configure_globals",
                    snippet: "global.score = 0;",
                    summary: "Script that configures global values."
                },
                {
                    displayName: "obj_player",
                    filePath: null,
                    graphId: "project",
                    id: "object-node",
                    kind: "object",
                    lineEnd: null,
                    lineStart: null,
                    name: "obj_player",
                    resourcePath: "objects/obj_player/obj_player.yy",
                    scopeId: null,
                    scipSymbol: null,
                    snippet: "",
                    summary: "Player object."
                }
            ],
            projectRoot: "/tmp/project"
        },
        documentationCatalogs: null,
        isServerMode: true,
        lastFixRun: null,
        loadedTarget: {
            activePath: "/tmp/project/Game.yyp",
            projectRoot: "/tmp/project",
            selectedPaths: [],
            source: "working-directory"
        },
        liveReload: null,
        mcpServerStatus: "not-started",
        projectConfigurationCatalog: null,
        startupState: null,
        title: "Test Graph"
    };
}

/**
 * Builds a minimal {@link GraphVisualizationUiState} anchored on the graph page with
 * the visual view selected so tests can render the panel without navigating first.
 */
export function createGraphState(): GraphVisualizationUiState {
    return {
        ...createInitialGraphVisualizationUiState(),
        activeGraphView: "visual",
        activePage: "graph"
    };
}
