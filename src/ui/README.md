# @gmloop/ui

`@gmloop/ui` is the monorepo workspace that owns cross-project user interfaces for GMLoop.

The workspace exists to keep UI code separate from domain logic. The long-term scope includes:

- graph-index visualizations
- AST preview surfaces
- CLI documentation views
- MCP tool browsers
- formatter, lint, and refactor rule explorers
- other cross-workspace dashboards and inspectors

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

## Design Rules

- UI modules should accept explicit data payloads and configuration inputs.
- UI modules should not reach into parser, semantic, lint, or refactor internals.
- UI modules should avoid hidden side effects and should be render-oriented.
- When a UI needs new data, add a narrow API to the owning workspace rather than copying the logic into `@gmloop/ui`.
- When a UI needs a new action, the action should be implemented by the owning workspace or orchestration layer and surfaced into the UI as a callback, endpoint, or serialized contract.
- Keep UI feature code organized by surface or domain, for example `graph/`, `ast/`, `cli-docs/`, `mcp/`, `rules/`.

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
    graph/
      index.ts
      graph-visualization-template.ts
  test/
    graph-visualization-template.test.ts
```

This keeps the public API explicit while leaving room for additional UI domains.

## First Iteration: Graph Visualization

The first `@gmloop/ui` feature is the graph-index visualization template that was previously embedded in `@gmloop/cli`.

The split is now:

- `@gmloop/semantic`: exports the graph visualization payload
- `@gmloop/ui`: renders the graph visualization HTML and client behavior
- `@gmloop/cli`: chooses whether to write or serve the UI, and whether to trigger regeneration

That separation is intentional and should be preserved as more UI surfaces are added.
