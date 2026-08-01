# @gmloop/ui

`@gmloop/ui` is the monorepo workspace that owns cross-project user interfaces for GMLoop.

The workspace exists to keep UI code separate from domain logic. The long-term scope includes:

- graph-index visualizations
- AST preview surfaces
- CLI documentation views
- Auto-Game creation pipeline observability with MCP bridge visibility
- formatter, lint, and refactor rule explorers
- project fix, format, refactor/codemod, and lint workflow launchers
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
- model selection, agent scheduling, task routing, or retry policy
- approvals, permissions, agent memory, budgets, queues, or durable workflow state
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
- the Docs surface includes `CLI`, `MCP`, `Linting`, `Formatting`, and `Codemods` subviews for command, tool, and workspace rule catalogs
- the Auto-Game surface renders automation history, AI skill readiness, LLM output snippets, and MCP bridge information to observe external agent activity without executing the pipeline or prompt inputs directly
- loaded project state is shown in one canonical header location and reflects the active graph/config context
- the Open Project action accepts only a validated GameMaker `.yyp` manifest; project directories and malformed or non-project JSON files are rejected before the active project changes
- graph/docs/config/fix/playground/auto-game/live-reload page state, docs subview state, graph view mode, label mode, and search query are shareable through URL query params
- project-wide fix, format, lint, refactor, and semantic-index operations coordinate through `<project>/.gmloop/operation-state.json`; the CLI and MCP-backed CLI paths publish one active operation, while the Graph Index page reads `/api/graph-index/progress` so a UI opened during semantic analysis shows the same phase, parse progress, and output without duplicating work

## Design Rules

- UI modules should accept explicit data payloads and configuration inputs.
- UI modules should not reach into parser, semantic, lint, or refactor internals.
- UI modules should avoid hidden side effects and should be render-oriented.
- When a UI needs new data, add a narrow API to the owning workspace rather than copying the logic into `@gmloop/ui`.
- When a UI needs a new action, the action should be implemented by the owning workspace or orchestration layer and surfaced into the UI as a callback, endpoint, or serialized contract.
- Keep UI feature code organized by surface or domain, for example `graph/`, `ast/`, `cli-docs/`, `auto-game/`, `rules/`.
- Maintain a canonical top-level surface catalog in code so future UI tabs are discoverable and consistently named.

## Template Whitespace Rules

Lit templates are whitespace-sensitive for inline elements (elements that receive their content through `html` interpolation without child nodes). Any indentation or newlines between an opening tag and its closing tag become text nodes in the rendered DOM. This produces unwanted visual padding and can break assumptions in styling.

Symptoms include visible extra padding in output panes, mismatch with `white-space: pre` layouts, and broken test assertions like `doesNotMatch(rendered, /<element>\s+\S/u)`.

The rule: for inline elements where content is provided via interpolation, keep the `html` template on a single line with no leading or trailing whitespace:

```ts
// ✅ Correct — no whitespace between opening and closing tags
return html`<div class="output">${content}</div>`;

// ❌ Incorrect — indentation becomes a text node, visible in the rendered output
return html`<div class="output">${content}</div>`;
```

When a template must be broken across multiple lines (e.g., for readability), extract the element into a private class method or module-level helper that returns the complete `TemplateResult` on a single line. See `GmPlaygroundPanel.#renderOutput` and its test "playground panel output does not have leading whitespace nodes" for a reference implementation.

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

## Shared Status Badges

`gm-status-chip` is the shared status badge for feature-page health and lifecycle state. Feature pages must select one of the component's supported statuses instead of passing arbitrary label text, so copy and styling remain consistent across surfaces.

Buttons that start asynchronous host processes use the shared process-button content primitive and one pending-state contract. From invocation until settlement, the initiating button keeps its normal label, adds the shared loading circle, sets `aria-busy="true"`, and becomes natively disabled so the standard disabled cursor and duplicate-submission protection apply. Related controls that could start a conflicting process are disabled for the same interval. New process buttons must extend this shared behavior instead of adding component-specific spinner markup or pending labels.

Each tab has one top-level page toolbar. That toolbar owns the page title, subtitle, page-level status badge, and any main controls for the current tab. Auto-Game and Live Reload status badges belong in the shared page toolbar title row, Live Reload start/open/stop controls belong in that same toolbar, and Docs subview/search controls belong in the shared toolbar instead of the Docs panel body. Docs subview tabs use the shared `gm-view-selector` tab control so CLI, MCP, Linting, Formatting, Codemods, Playground, and Config selectors keep one visual treatment.

## Auto-Game Surface

The Auto-Game surface is a companion interface for pipeline execution. It focuses on observability, listing discovered skills, and managing agent-pack synchronization. It scans only `<loaded-game-project>/.agents/skills`, renders every discovered skill with its name, description, source path, file-availability status, and enable/disable toggle, initializes or updates project resources from the standalone `@gmloop/agent-pack`, and persists only disabled-name exceptions in `gmloop.json`. The project skill list is a native disclosure that is closed by default so the operations dashboard remains compact and keyboard accessible.

This surface may expose MCP/tool readiness, graph and search context,
validation evidence, fix/refactor actions, live-reload status, and lightweight
handoffs such as copying a prompt, opening an external agent, or launching a
configured companion command. It must not become a multi-agent DAG editor,
model router, arbitrary-framework prompt debugger, workflow engine,
approval/permission system, memory store, or background task queue. External
agent coordinators own those concerns; the UI remains vendor-neutral and
coordinator-neutral.

When the opened project has no recorded agent-pack installation and no skills, the empty state offers **Initialize Auto-Game Agent Pack**. If project skills exist without an installation receipt, it reports **Setup Incomplete** and offers **Complete Auto-Game Setup** because GMLoop cannot infer their package version or safely treat the full pack as current. When the installed version is older than GMLoop's available package version, it offers **Update Auto-Game Agent Pack**. A default-checked **Update Project .gitignore** option controls whether initialization merges GMLoop's generated/cache paths into the project-root ignore file. The same setup area lists detected Codex, Gemini/Antigravity, and Qwen integration targets. Only CLI-configurable detected targets are selectable by default; manual-required or unavailable targets remain visible but disabled with provider-owned setup guidance. The host materializes standard skills and applicable guidance such as `AGENTS.md`, invokes supported provider CLIs for selected MCP setup, preserves project-authored or modified files, reports conflicts and server failures, and returns refreshed project skill state after success.

The AI Skills card also exposes keyboard-native previews for the packaged `AGENTS.md`, `.gitignore`, and every file in the packaged skill directories. These previews always show the read-only package source before synchronization; they do not imply that the resource is installed and do not substitute project-authored or project-modified content.

While initialization or update is pending, its action button is disabled, retains its action label, displays the shared loading circle, and exposes busy state to assistive technology. The `.gitignore` option and skill mutations are disabled until the operation settles so the submitted initialization options cannot change mid-process.

All discovered project skills are included in Auto-Game by default and every skill can be excluded. Discovery is independent of the agent-pack receipt: a project-owned skill already present in `.agents/skills` remains usable when the pack is not initialized, and the UI labels that state separately from pack installation. GMLoop adds no activation, trust, approval, permission, installation, or execution layer; the active AI tool or CLI retains those responsibilities. UI metadata is extracted with the established `gray-matter` package, while Agent Skills conformance validation is delegated to the official `skills-ref` tool or another established standards-compatible validator rather than custom GMLoop parsing or validation logic.

The UI is AI-vendor neutral: its catalog contract contains standard skill metadata, project-relative paths, and agent-pack version/update status, not provider identifiers or client-specific activation state. Packaged skills are driven entirely by the standard directories published by `@gmloop/agent-pack`; adding a skill does not require a UI registration entry or skill-specific rendering logic.

The GMLoop source repository's `.agents/skills` directory is exclusively for agents developing GMLoop. The Auto-Game UI and CLI host never read or modify it.

Observability is driven by host-provided state. Dispatched events for skill configuration and initialization are routed to host callbacks:

- `onInitializeAutoGameAgentPack`
- `onSetAutoGameSkillEnabled`

`onInitializeAutoGameAgentPack` receives `{ agentTargets: readonly ("codex" | "gemini" | "qwen")[], includeGitIgnore: boolean, includeVSCode: boolean }`, matching the selected provider CLI targets and initialization checkboxes.

## Live Reload Surface

The Live Reload surface is observability-only. It displays data from the CLI status server and host-provided runtime-wrapper summaries without owning the hot-reload pipeline itself.

- `@gmloop/cli` owns file watching, transpilation orchestration, WebSocket patch streaming, and `/status`.
- `@gmloop/runtime-wrapper` owns browser-side patch application, queueing, rollback, registry state, and runtime diagnostics.
- `@gmloop/ui` owns the presentation model, automatic polling display, cards, recent patch/error lists, and optional runtime health rendering.

Hosts provide live-reload startup data through `GraphVisualizationRenderOptions.liveReload` and server-mode start/stop callbacks. Once a live-reload model includes a status URL, the Live Reload page updates status automatically by polling on a timer and by polling when the document becomes visible again. The Live Reload page must not expose a manual status-refresh button or host refresh callback; status freshness is owned by the timer/focus polling loop so the UI cannot drift into a separate manual-refresh state. In server mode, the Stop control is always rendered in the shared page toolbar and uses disabled state to communicate availability; it is enabled only while an active live-reload session exists. Starting Live Reload from the UI must complete build/startup sequencing before the runtime tab opens: the host start endpoint reports success only with a concrete runtime URL, and the browser opens that URL directly instead of reserving an `about:blank` placeholder tab. UI starts use start-or-reuse semantics instead of forced restart semantics so a healthy existing watcher/status/runtime session is adopted instead of spawning a duplicate process into occupied ports; when a new watcher child is required, the graph server assigns per-session status and WebSocket ports and polls those exact endpoints instead of binding the fixed default ports. UI hot reloads from Vite or the served-UI revision watcher must preserve the host-owned game Live Reload session. Start and stop callbacks mirror the active live-reload model into the web bootstrap payload so a UI remount cannot show stale "not running" controls while the watcher process is still active.

## Serve Host Contract

`@gmloop/ui` does not invoke native dialogs or perform local filesystem selection itself. The host workspace provides that behavior and passes loaded-target metadata into the renderer.

The shipped `graph visualize` bundle and development web entry both mount the same Lit shell. That single path owns graph/docs/config/fix/playground/auto-game/live-reload rendering and must preserve the same user-facing navigation contract in export and serve modes.

Current graph serve-mode host actions are:

- `POST /api/reindex`: force-regenerate the current graph index
- `POST /api/open`: switch the active UI project globally using a validated `.yyp` path; an omitted path opens the native `.yyp` file picker. The endpoint acknowledges the selected target immediately, while semantic indexing and dependent artifact refresh continue in the background and publish scoped loading/progress state.
- `POST /api/fix`: run the requested `fix`, `format`, `refactor`, or `lint` project workflow in write mode and return log lines for the Fix tab
- `GET /api/fix/progress`: return the graph host's local workflow or the shared project `.gmloop/operation-state.json` progress/output for an external CLI or MCP-backed `fix`, `format`, `refactor`, or `lint` operation so the Fix tab stays synchronized across UI hot-reloads and refreshes
- `GET /api/graph-index/progress`: return the shared semantic-index phase, GML parse progress, output, and completion status for the Graph Index page; this remains readable when the UI attaches after CLI/MCP analysis has started
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
- `auto-game`: implemented
- `playground`: implemented
- `rules`: planned

New top-level UI additions should:

1. Add a stable surface id to the catalog.
2. Add a dedicated `src/<surface>/` domain directory.
3. Consume data only from the owning functional workspace or orchestration layer.
4. Avoid recreating parser, semantic, lint, refactor, CLI, or MCP logic inside `@gmloop/ui`.

---

## References

- [Lit Documentation](https://lit.dev/docs/)
- [artmsilva/lit-best-practices rules](https://github.com/artmsilva/lit-best-practices/tree/main/rules)
- [web.dev Custom Elements Best Practices](https://web.dev/articles/custom-elements-best-practices)
- [WAI-ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/patterns/)
- [MDN: `inert`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert)
- [MDN: Safe area env()](https://developer.mozilla.org/en-US/docs/Web/CSS/env)
- [APCA Contrast](https://apcacontrast.com/)

---

## TODO

- **BUG**: Selecting _any_ format option in the `Playground` tab/page for the format settings seems to enable the whole/default format settings too, not _just_ that one control. Also not sure if the select-options are actually hooked up to live-update the playground's output view?
- **FEAT**: For the playground tab/page, user should be able to select _any_ of the 'golden' fixture .gml files to preview/test. Or, maybe this is only true if np project is opened in the UI. If a GameMaker project _is_ opened in the UI, then the user could be able to select on of the .gml files from that project and test applying rules to those instead.
- **FEAT**: For all raw-JSON displayed in the UI, add a "copy to clipboard" button (single, reusable component) that copies the raw JSON string to the clipboard for easy external use.
- **FEAT**: For _all_ raw-JSON displayed in the UI, allow for collapsing/expanding nested objects and arrays for easier readability.
- **BUG**: On the "Docs" page/tab, the search bar and its subtitle "Search current docs view" are misaligned from the toolbar's subtabs-component (CLI, MCP, etc.). The search bar should be visually aligned vertically with that subtab component.
- **BUG**: On the "Docs" page/tab, when typing in the search bar, it does not allow certain characters like "r" to be typed (maybe those that are also used as hotkeys for the UI?). The search bar should allow all characters to be typed, and hotkeys should not interfere with typing in the search bar.
- **BUG**: In the UI's navigation, instead of disabling the "Graph Index" menu-item/option tab/page when the opened project does not have a graph index, it should still be selectable since the user can generate it on that tab/page. _(Resolved: the shell-level navigation listener and the toolbar navigation emitter now route every top-level page request through the same reducer path, so the Graph Index tab is selectable even without a graph index loaded; the graph panel renders its existing empty state to explain how to load or rebuild a graph.)_
- **BUG**: When the GMLoop UI is served locally w/ live-reloading, when the UI code is changed and hot-reloads and the "Apply Fixes" fix-workflow is in-progress (on the "Fix" page/tab), the progress/state is reset/discarded when the UI hot-reloads. The fix workflow progress/state should be preserved across UI hot-reloads, so if the user is in the middle of a long-running fix workflow and makes a change to the UI code, they won't lose their place in the fix workflow and can continue to monitor its progress without interruption. Its possible it is still running in the background and the UI just loses the connection to it, so maybe we just need to re-establish the connection to the in-flight workflow after hot-reload instead of losing all progress/state.
- **FEAT**: In the UI's "Fix" page/tab (also probably the CLI output since they should be the same), it is unclear if/when GMLoop is rebuilding/updating the semantic-index. It just shows `[1/3 Refactor Codemods]... [namingConvention] running...` for a long time but we want some more visibility into when the semantic index is being updated, since that is a critical part of the process and can take a long time for larger projects. We should add some explicit log/status messages to indicate when the semantic index is being created/rebuilt/updated, and ideally also show progress updates for that step if possible (e.g. "Updating semantic index... [n%]").
- **FEAT**: In the UI's "Fix" page/tab we should have a way/button to stop/cancel an in-flight fix workflow, in case the user accidentally starts a fix workflow or realizes they need to change their fix configuration before starting the workflow
- **BUG**: On the UI's "Docs" page, "CLI" tab, some of the commands include `--path` even though that option does not seem to be supported by the CLI for that command. Ex. The page includes the command:
    ```
    generate-feather-metadata
    Generate feather-metadata.json from the GameMaker manual.
    gmloop generate-feather-metadata --path /Users/henrykirk/GMLoop/vendor/3DSpider
    ```
    But if copied and run in the terminal, it fails with error: `error: unknown option '--path'`.
- **BUG**: The expand/collapse toggle-symbol-arrow on the "Config" page does not change direction when the config section is expanded/collapsed. It should point down when expanded and point right when collapsed (currently fixed in down position). We should also just have one reusable collapse-panel component shared across the UI for all collapsible sections, instead of having each section implement its own expand/collapse behavior.
- **BUG**: The nodes in the UI's graph-index visualization are _extremely_ close together/overlapping making it impossible to read for large projects. We need some minimum spacing between nodes (Poisson disk sampling or something?). And/or way to 'collapse' certain node types into their parent node when zoomed out, and then expand them when zoomed in - like how Prezi works?
- **BUG**: The UI can show status "Live Reload: Scanning" on the "Live Reload" page/tab with subtitle "Uptime 0m 00s with scan in progress." in the header/toolbar and at the same time show "Scan complete\nUptime: 2m 02s" in the page's body. The header and body should be consistent and show the same status.
