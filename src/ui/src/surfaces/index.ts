/**
 * Supported top-level UI surface identifiers.
 */
export type UISurfaceId = "ast" | "docs" | "graph" | "rules";

/**
 * Delivery status for a top-level UI surface.
 */
export type UISurfaceStatus = "implemented" | "planned";

/**
 * Definition record for a top-level UI surface in the shared UI workspace.
 */
export type UISurfaceDefinition = Readonly<{
    description: string;
    id: UISurfaceId;
    owningWorkspace: "@gmloop/ui";
    status: UISurfaceStatus;
}>;

/**
 * Canonical catalog of cross-project UI surfaces managed by `@gmloop/ui`.
 */
const PLANNED_SURFACE_STATUS: UISurfaceStatus = "planned";
const UI_OWNING_WORKSPACE: UISurfaceDefinition["owningWorkspace"] = "@gmloop/ui";

export const UI_SURFACE_DEFINITIONS: ReadonlyArray<UISurfaceDefinition> = Object.freeze([
    {
        description: "Graph-index visualization and hosted graph inspection flows.",
        id: "graph",
        owningWorkspace: UI_OWNING_WORKSPACE,
        status: "implemented"
    },
    {
        description: "AST preview and structural inspection surfaces sourced from parser-owned data contracts.",
        id: "ast",
        owningWorkspace: UI_OWNING_WORKSPACE,
        status: PLANNED_SURFACE_STATUS
    },
    {
        description: "Combined CLI and MCP documentation browsing surface with an internal view toggle.",
        id: "docs",
        owningWorkspace: UI_OWNING_WORKSPACE,
        status: "implemented"
    },
    {
        description: "Formatter, lint, and refactor rule explorer surfaces sourced from workspace-owned rule catalogs.",
        id: "rules",
        owningWorkspace: UI_OWNING_WORKSPACE,
        status: PLANNED_SURFACE_STATUS
    }
]);

/**
 * Look up one top-level UI surface definition by its stable id.
 */
export function getUISurfaceDefinition(surfaceId: UISurfaceId): UISurfaceDefinition {
    const surfaceDefinition = UI_SURFACE_DEFINITIONS.find((entry) => entry.id === surfaceId);
    if (!surfaceDefinition) {
        throw new Error(`Unknown UI surface id '${surfaceId}'.`);
    }
    return surfaceDefinition;
}
