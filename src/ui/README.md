# @gmloop/ui

`@gmloop/ui` is the monorepo workspace that owns cross-project user interfaces for GMLoop.

The workspace exists to keep UI code separate from domain logic. The long-term scope includes:

- graph-index visualizations
- AST preview surfaces
- CLI documentation views
- MCP tool browsers
- formatter, lint, and refactor rule explorers
- project fix workflow launchers
- live-reload observability
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
- runtime-wrapper patch application
- hot-reload watch, transpile, or WebSocket server lifecycle

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
- Included-file resources under `datafiles/**` are rendered as `data_file` nodes. `.gml`, `.yy`, and `.yyp` paths may be shown as node provenance, but they are not standalone graph nodes.
- The graph legend shows every supported user-facing node kind, including absent resource categories such as sounds, particles, timelines, and tile sets. Internal project nodes and obsolete generic file nodes are not filterable legend entries. `Resource` is a colorless organizational parent for concrete resource kinds, not a graph node kind.

This pattern should remain the template for future UI surfaces:

1. A functional workspace exposes a narrow, testable data API.
2. `@gmloop/cli` or another orchestration layer handles command/server lifecycle when needed.
3. `@gmloop/ui` renders that data without recreating the source logic.

## Implemented Contract

The current graph UI uses a typed bundle-render boundary and a Lit component shell.

- `renderGraphVisualizationBundle(data, options)` is the primary renderer entrypoint
- renderer output is a filesystem-ready artifact: `index.html` + local `assets/*` files
- bundle assets include the local Vite-built Lit shell and stylesheet assets (no CDN dependencies)
- CLI host code is responsible for obtaining payloads and writing/serving the emitted bundle artifact
- graph/docs/config tabs are rendered from live workspace-fed catalogs
- the Fix tab delegates configured refactor, lint, and format mutation to the CLI host, renders status/log output, and shows elapsed-time progress updates while runs are pending
- the Live Reload surface renders watcher, WebSocket, patch, latency, error, and optional runtime-wrapper health snapshots from UI-owned DTOs
- the Docs surface includes `CLI`, `MCP`, and `Rules` subviews for command, tool, and workspace rule catalogs
- loaded project state is shown in one canonical header location and reflects the active graph/config context
- graph/docs/config/fix/playground/MCP/live-reload page state, docs subview state, graph view mode, label mode, and search query are shareable through URL query params

## Design Rules

- UI modules should accept explicit data payloads and configuration inputs.
- UI modules should not reach into parser, semantic, lint, or refactor internals.
- UI modules should avoid hidden side effects and should be render-oriented.
- When a UI needs new data, add a narrow API to the owning workspace rather than copying the logic into `@gmloop/ui`.
- When a UI needs a new action, the action should be implemented by the owning workspace or orchestration layer and surfaced into the UI as a callback, endpoint, or serialized contract.
- Keep UI feature code organized by surface or domain, for example `graph/`, `ast/`, `cli-docs/`, `mcp/`, `rules/`.
- Maintain a canonical top-level surface catalog in code so future UI tabs are discoverable and consistently named.

## Workspace Structure

The current workspace structure is:

```text
src/ui/
  index.ts
  package.json
  README.md
  tsconfig.json
  src/
    index.ts
    app/
      index.ts
      bootstrap.ts
      components/
      state/
    surfaces/
      index.ts
    web/
      index.html
      main.ts
      register-components.ts
      styles/
    graph/
      index.ts
      graph-visualization-inline-data.ts
      graph-visualization-style-metadata.ts
      graph-visualization-bundle.ts
      graph-viewport.ts
      types.ts
  vite.config.ts
  test/
    graph-visualization-bundle.test.ts
    ui-surfaces.test.ts
```

This keeps the public API explicit while leaving room for additional UI domains.

## Graph Visualization Split

The graph visualization surface is split as:

- `@gmloop/semantic`: exports the graph visualization payload
- `@gmloop/ui`: owns Lit components, graph rendering, CSS assets, and bundle rendering contracts
- `@gmloop/cli`: chooses whether to write or serve the UI bundle, owns the HTTP host server, owns regeneration endpoints, and owns native file-picker integration

That separation is intentional and should be preserved as more UI surfaces are added.

## Live Reload Surface

The Live Reload surface is observability-only. It displays data from the CLI status server and host-provided runtime-wrapper summaries without owning the hot-reload pipeline itself.

- `@gmloop/cli` owns file watching, transpilation orchestration, WebSocket patch streaming, and `/status`.
- `@gmloop/runtime-wrapper` owns browser-side patch application, queueing, rollback, registry state, and runtime diagnostics.
- `@gmloop/ui` owns the presentation model, polling display, refresh event, cards, recent patch/error lists, and optional runtime health rendering.

Hosts can provide live-reload data through `GraphVisualizationRenderOptions.liveReload` or the `onRefreshLiveReloadStatus` callback.

## Serve Host Contract

`@gmloop/ui` does not invoke native dialogs or perform local filesystem selection itself. The host workspace provides that behavior and passes loaded-target metadata into the renderer.

The shipped `graph visualize` bundle and development web entry both mount the same Lit shell. That single path owns graph/docs/config/fix/playground/MCP/live-reload rendering and must preserve the same user-facing navigation contract in export and serve modes.

Current graph serve-mode host actions are:

- `POST /api/reindex`: force-regenerate the current graph index
- `POST /api/open`: switch the active UI project globally, optionally using a caller-supplied `path`
- `POST /api/fix`: run the opened project's configured fix workflow in write mode and return log lines for the Fix tab
- `GET /api/fix/progress`: return the latest in-flight fix workflow log lines so the Fix tab can live-update while work is running
- `POST /api/live-reload/start`: build and start the configured live-reload pipeline, then return the latest live-reload model

The host serves the bundle entry document and static asset files, while `@gmloop/ui` remains responsible for typed rendering contracts and client presentation behavior.

## Surface Convention

The canonical current and planned top-level UI surfaces are tracked in code through `UI_SURFACE_DEFINITIONS`.

- `graph`: implemented
- `ast`: planned
- `config`: implemented
- `docs`: implemented
- `fix`: implemented
- `live-reload`: implemented
- `mcp`: implemented
- `playground`: implemented
- `rules`: planned

New top-level UI additions should:

1. Add a stable surface id to the catalog.
2. Add a dedicated `src/<surface>/` domain directory.
3. Consume data only from the owning functional workspace or orchestration layer.
4. Avoid recreating parser, semantic, lint, refactor, CLI, or MCP logic inside `@gmloop/ui`.

----

## References

- [Lit Documentation](https://lit.dev/docs/)
- [artmsilva/lit-best-practices rules](https://github.com/artmsilva/lit-best-practices/tree/main/rules)
- [web.dev Custom Elements Best Practices](https://web.dev/articles/custom-elements-best-practices)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/)
- [MDN: `inert`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert)
- [MDN: Safe area env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env)
- [APCA Contrast](https://apcacontrast.com/)

----

## TODO
- **FEAT**: Add syntax highlighting to the `Playground` code (both `gml` and `js`)
- **BUG**: Selecting *any* format option in the `Playground` tab/page for the format settings seems to enable the whole/default format settings too, not *just* that one control. Also not sure if the select-options are actually hooked up to live-update the playground's output view?
- **FEAT**: For the playground tab/page, user should be able to select *any* of the 'golden' fixture .gml files to preview/test. Or, maybe this is only true if np project is opened in the UI. If a GameMaker project *is* opened in the UI, then the user could be able to select on of the .gml files from that project and test applying rules to those instead.
- **FEAT**: The `Config` tab/page in the UI should allow for building/modifying a `gmloop.json` config file and then have an option to download it. If a project is opened and there is no `gmloop.json` present in it, users on the `Config` tab/page should be able to generate one which will then be added/included into their project's root directory. We can have a default/recommended `gmloop.json` with the recommended values & naming conventions. Users can, of course, then edit/modify that config the same way as a loaded one from then on.
