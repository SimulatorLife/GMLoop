# @gmloop/ui

`@gmloop/ui` is the monorepo workspace that owns cross-project user interfaces for GMLoop.

The workspace exists to keep UI code separate from domain logic. The long-term scope includes:

- graph-index visualizations
- AST preview surfaces
- CLI documentation views
- MCP tool browsers
- formatter, lint, and refactor rule explorers
- other cross-workspace dashboards and inspectors

The implemented v1 contract is now:

- producing workspaces own data/view-model generation
- `@gmloop/ui` owns typed renderers and client interaction code
- host layers such as `@gmloop/cli` own write/serve/regenerate lifecycle

## Goals

- Provide a single UI workspace for all product-facing views instead of embedding UI logic into `@gmloop/cli`, `@gmloop/semantic`, `@gmloop/lint`, or other functional workspaces.
- Keep functionality workspaces free of UI dependencies.
- Reuse existing workspace behavior through explicit delegation instead of reimplementing parser, semantic, CLI, lint, formatter, refactor, or MCP logic inside the UI layer.
- Establish a stable convention for future UI tabs and visualizations.

## Ownership Boundary

`@gmloop/ui` owns:

- rendering HTML, CSS, and client-side interaction code
- view state, local filtering, local toggles, and presentational interaction behavior
- composition of already-produced data into user-facing interfaces
- UI-specific affordances such as loading indicators, tab shells, inspector panels, and view switching
- typed rendering contracts for UI surfaces

`@gmloop/ui` does not own:

- graph indexing
- semantic analysis
- AST generation
- lint rule execution
- formatting
- refactor planning or mutation
- CLI command parsing
- HTTP server lifecycle
- MCP tool discovery or execution

That logic must remain in the existing functional workspaces.

## Delegation Contract

The UI workspace must consume functionality through workspace APIs rather than duplicating behavior.

The intended dependency direction is:

- `@gmloop/core`, `@gmloop/parser`, `@gmloop/semantic`, `@gmloop/lint`, `@gmloop/refactor`, `@gmloop/transpiler`, `@gmloop/mcp`, and `@gmloop/cli` expose domain APIs
- `@gmloop/ui` consumes serialized data, callbacks, or view models built from those APIs
- the functional workspaces must not import `@gmloop/ui`

For the first iteration:

- `@gmloop/semantic` owns graph-export data generation
- `@gmloop/cli` owns `graph visualize` command orchestration, file output, server mode, and regeneration endpoints
- `@gmloop/ui` owns the graph visualization renderer and browser interaction behavior

This pattern should remain the template for future UI surfaces:

1. A functional workspace exposes a narrow, testable data API.
2. `@gmloop/cli` or another orchestration layer handles command/server lifecycle when needed.
3. `@gmloop/ui` renders that data without recreating the source logic.

## Implemented Contract

The current graph UI now uses a typed render boundary instead of a raw JSON-string API.

- `renderGraphVisualizationHtml(data, options)` is the renderer entrypoint
- the renderer accepts typed graph payload objects
- JSON serialization for inline browser execution happens inside `@gmloop/ui`, not in CLI call sites
- CLI host code is responsible only for obtaining payloads and invoking the renderer

This keeps UI rendering typed while still keeping serialization at the browser-document edge.

## Design Rules

- UI modules should accept explicit data payloads and configuration inputs.
- UI modules should not reach into parser, semantic, lint, or refactor internals.
- UI modules should avoid hidden side effects and should be render-oriented.
- When a UI needs new data, add a narrow API to the owning workspace rather than copying the logic into `@gmloop/ui`.
- When a UI needs a new action, the action should be implemented by the owning workspace or orchestration layer and surfaced into the UI as a callback, endpoint, or serialized contract.
- Keep UI feature code organized by surface or domain, for example `graph/`, `ast/`, `cli-docs/`, `mcp/`, `rules/`.
- Maintain a canonical top-level surface catalog in code so future UI tabs are discoverable and consistently named.

## Initial Structure

The initial workspace structure is:

```text
src/ui/
  index.ts
  package.json
  README.md
  tsconfig.json
  src/
    index.ts
    surfaces/
      index.ts
    graph/
      index.ts
      graph-visualization-client-script.ts
      graph-visualization-inline-data.ts
      graph-visualization-style-metadata.ts
      graph-visualization-template.ts
      types.ts
  test/
    graph-visualization-template.test.ts
    ui-surfaces.test.ts
```

This keeps the public API explicit while leaving room for additional UI domains.

## First Iteration: Graph Visualization

The first `@gmloop/ui` feature is the graph-index visualization template that was previously embedded in `@gmloop/cli`.

The split is now:

- `@gmloop/semantic`: exports the graph visualization payload
- `@gmloop/ui`: renders the graph visualization HTML, owns typed graph UI contracts, and owns client behavior
- `@gmloop/cli`: chooses whether to write or serve the UI, owns the HTTP host server, owns regeneration endpoints, and owns native file-picker integration

That separation is intentional and should be preserved as more UI surfaces are added.

## Serve Host Contract

`@gmloop/ui` does not invoke native dialogs or perform local filesystem selection itself. The host workspace provides that behavior and passes loaded-target metadata into the renderer.

Current graph serve-mode host actions are:

- `POST /api/reindex`: force-regenerate the current graph index
- `POST /api/open`: open the native project picker and switch the active UI project globally

The renderer receives a typed `loadedTarget` object and only displays it. Target-path resolution remains in CLI using the same path handling contract as `--path` (`.yyp` normalization, `.gml` file path handling, project-root discovery).

## Surface Convention

The canonical current and planned top-level UI surfaces are tracked in code through `UI_SURFACE_DEFINITIONS`.

- `graph`: implemented
- `ast`: planned
- `cli-docs`: planned
- `mcp`: planned
- `rules`: planned

New top-level UI additions should:

1. Add a stable surface id to the catalog.
2. Add a dedicated `src/<surface>/` domain directory.
3. Consume data only from the owning functional workspace or orchestration layer.
4. Avoid recreating parser, semantic, lint, refactor, CLI, or MCP logic inside `@gmloop/ui`.
