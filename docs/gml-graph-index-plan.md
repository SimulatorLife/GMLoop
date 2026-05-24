# GML Graph Index and Visualization Plan

## Summary

The GML graph index is the semantic-owned retrieval layer for GameMaker project understanding. It projects parser and semantic analysis results into a persistent graph that supports search, symbol lookup, context retrieval, dependency exploration, CLI commands, MCP resources, UI graph exploration, and offline visualization.

The target state is a single graph platform, not separate indexing and visualization systems:

```text
parser/project metadata
  -> @gmloop/semantic project analysis
    -> semantic-owned graph index and query APIs
      -> @gmloop/cli graph commands and JSON envelopes
        -> @gmloop/mcp CLI-derived tools and read-only resources
        -> @gmloop/ui graph explorer and generated visualization artifacts
```

This document replaces separate graph-index and graph-visualization plans. It should describe stable architecture and direction rather than track which individual commands or UI affordances have already been implemented.

## Ownership Boundaries

| Workspace | Owns | Must not own |
| --- | --- | --- |
| `@gmloop/semantic` | Graph facts, graph projection, persistent schema, search, summaries, snippets, embeddings, graph query APIs, visualization data export. | CLI parsing, HTML rendering, UI presentation policy, MCP tool transport, source edits. |
| `@gmloop/cli` | Human-facing graph commands, JSON envelopes, command catalog metadata, export/open behavior for generated visualization artifacts. | Raw SQL queries, duplicate graph projection, browser UI component logic. |
| `@gmloop/mcp` | CLI-derived graph tools and read-only graph/context resources. | MCP-only graph command implementations or separate business logic. |
| `@gmloop/ui` | Interactive in-app graph exploration, layout, filtering, accessibility, and visual presentation. | Semantic graph truth, graph persistence, project indexing. |
| `@gmloop/refactor` | Project-aware edit planning that may consume graph facts. | Graph indexing or graph query ownership. |

The semantic graph index is a data and retrieval layer. It may expose facts to lint, refactor, transpiler, CLI, MCP, and UI consumers, but it should not make their policy decisions.

## Target Graph Model

The graph index should represent both project code and GameMaker resource metadata with stable identities.

Core graph scopes:

- `project`: the active GameMaker project.
- `toolset`: an optional reusable toolset/helper project.
- future scopes only when they have a concrete product need, not speculative multi-root generalization.

Canonical identity:

- SCIP-shaped symbols remain the canonical identity for definitions and references.
- Graph-qualified node IDs are retrieval keys layered on top of canonical symbols.
- IDs must be stable across rebuilds when source identity has not changed.

Example node IDs:

```text
project::gml/script/<name>
toolset::gml/script/<name>
project::resource::<resource-path>
project::file::<relative-path>
```

Target node categories:

- GML symbols: scripts, functions, methods, macros, enums, enum members, variables where project-wide identity is meaningful.
- GameMaker resources: objects, rooms, sprites, sounds, shaders, scripts, paths, fonts, sequences, tile sets, included files, and other real resource categories.
- Files and containers only when they clarify ownership or navigation.
- Built-ins/manual symbols where needed for symbol resolution and context.

Target edge categories:

- definition and containment relationships.
- references, calls, reads, writes, inherits, creates, places-in-room, depends-on, resource-uses-resource.
- project-to-toolset links such as `uses_toolset` only when a project reference resolves uniquely to the toolset and is not project-local.
- unresolved and ambiguous references should be represented explicitly where they help diagnostics or retrieval.

Graph projection must avoid misleading duplicate nodes. For example, script resources, script files, and functions should have distinct roles only when those roles are semantically different and useful to users. The graph should not create duplicate “script resource”, “script”, and “function” nodes for the same concept unless containment makes the distinction clear.

## Storage and Indexing Strategy

The graph index belongs under `@gmloop/semantic` and should build on the existing semantic project index rather than introduce a parallel parser or project scanner.

Target storage:

- Use a semantic-owned persistent indexed store for retrieval workloads.
- Keep storage behind typed adapter interfaces so graph facts remain the canonical model.
- SQLite is an appropriate execution backend for relational graph queries, FTS search, integrity checks, and durable graph state.
- Internal storage choices should not become broad user-facing configuration knobs.

Target schema capabilities:

- graph descriptors.
- files.
- nodes.
- edges.
- aliases.
- summaries and bounded declaration snippets.
- embeddings or vector blobs where enabled.
- index state and content hashes.
- schema versioning and migration state.
- full-text search over normalized searchable node text.

Indexing behavior:

- Resolve the active project root from CLI path/config.
- Resolve an optional toolset root from CLI/config.
- Run semantic project indexing for each root independently.
- Project semantic results into graph records.
- Preserve unchanged graph slices across rebuilds when content hashes and schema state make that safe.
- Remove stale deleted-file rows deterministically.
- Prefer bounded-memory streaming/chunking over whole-project aggregates where project size creates memory pressure.

Doctor behavior:

- Report schema version, storage runtime, index freshness, root paths, missing roots, stale files, quick-check/integrity status, foreign-key violations, embedding/model state, and actionable rebuild guidance.
- Do not leave storage/runtime assumptions implicit.

## Search, Context, and Retrieval

Graph retrieval should help humans and agents understand a project without dumping the entire graph.

Target APIs in `@gmloop/semantic`:

- build or open graph index.
- search graph nodes.
- inspect one symbol or node.
- retrieve context bundles.
- retrieve neighbors.
- retrieve usages.
- retrieve dependents/dependencies.
- export visualization-ready data.
- run graph doctor.

Search strategy:

- Use exact ID/name lookup first where applicable.
- Use aliases for known alternate spellings or resource names.
- Use full-text search for lexical queries.
- Use local embeddings as an optional rerank path when they improve semantic retrieval.
- Keep embedding providers local-only by default; network embedding providers are out of scope unless explicitly introduced with privacy and configuration constraints.

Context bundle behavior:

- Return compact, ranked, explainable context.
- Include source paths, resource paths, ranges, symbol IDs, node IDs, summaries, snippets, and relationship reasons.
- Bound snippets and result counts.
- Never return full-project source dumps or embedding vectors through normal context APIs.
- Preserve deterministic ordering so repeated agent runs remain stable.

## CLI and MCP Surface

The CLI is the canonical command surface. MCP exposes graph commands through CLI catalog derivation plus read-only resources.

Target CLI commands:

```text
gmloop graph index
gmloop graph search
gmloop graph symbol
gmloop graph context
gmloop graph neighbors
gmloop graph usages
gmloop graph doctor
gmloop graph visualize
```

Target common options:

```text
--path <path>
--config <path>
--toolset-root <path>
--database-path <path>
--json
--limit <n>
--depth <n>
--force or --rebuild
```

CLI requirements:

- concise human output by default.
- stable JSON envelopes for automation.
- deterministic ordering.
- clear non-zero exit behavior.
- actionable errors with paths and next steps.
- no raw SQL or storage internals in CLI code.

MCP requirements:

- CLI graph leaf commands become MCP tools through the command catalog.
- Tool schemas should derive from CLI metadata.
- Nonzero graph command results should surface as tool errors.
- MCP may expose read-only graph resources when they are useful for agent context.

Target MCP resources:

```text
gm://graph/overview
gm://graph/project/overview
gm://graph/toolset/overview
gm://node/<id>
gm://context/<id>?depth=2
gm://neighbors/<id>?depth=2
```

MCP must not implement a second graph query layer or MCP-only graph commands.

## Visualization Target State

Graph visualization is a presentation layer over semantic graph facts. It should reuse the same semantic query/export APIs as CLI and MCP, not read storage directly.

Two visualization surfaces are valid:

1. `@gmloop/ui` in-app graph explorer for persistent browsing, filtering, graph panels, project context, and future workflow integration.
2. `gmloop graph visualize` generated artifact for offline inspection and easy sharing/debugging.

The generated artifact target:

- read-only.
- offline-capable.
- self-contained where practical.
- no dev server required.
- generated by the CLI from semantic visualization data.
- opened in a browser only as a CLI presentation convenience.

The UI target:

- Lit + TypeScript with light-DOM components.
- consumes graph data through host-provided APIs or exported graph payloads.
- owns layout, filtering, interaction, accessibility, and responsive behavior.
- does not duplicate graph truth.

Visualization payload:

```ts
type GraphVisualizationData = Readonly<{
    generatedAt: string;
    graphs: ReadonlyArray<{
        edgeCount: number;
        graphId: string;
        nodeCount: number;
        rootPath: string;
    }>;
    edges: ReadonlyArray<{
        source: string;
        target: string;
        type: string;
    }>;
    nodes: ReadonlyArray<{
        displayName: string;
        graphId: string;
        id: string;
        kind: string;
        name: string;
        resourcePath: string;
        snippet: string;
        summary: string;
    }>;
    projectRoot: string;
}>;
```

The payload must exclude full file contents, embeddings, unbounded metadata, and storage-specific fields.

## Visualization Interaction Requirements

Interactive graph views should support:

- node coloring/grouping by kind.
- edge styling/filtering by type.
- project/toolset scope filtering.
- search-to-highlight.
- click-to-focus neighborhoods.
- zoom and pan.
- reset view.
- accessible labels and keyboard-reachable controls.
- legend for node kinds and edge types.
- empty, loading, stale, and error states.
- large-graph guardrails.

Large-graph behavior:

- Warn when graph size makes all-node rendering impractical.
- Offer automatic filters such as hiding file/container nodes, focusing a selected node neighborhood, or showing only nodes above a degree threshold.
- Keep labels hidden at low zoom levels and reveal them progressively.
- Prefer subgraph extraction for very large projects instead of trying to render everything.

Library guidance:

- Use established visualization libraries where they materially reduce risk.
- D3.js is a reasonable default for generated self-contained SVG artifacts.
- Cytoscape.js is a reasonable future option if graph-native operations, clustering, or compound nodes become more important.
- Do not add browser visualization dependencies to `@gmloop/semantic`.
- Do not require React or another framework for generated offline artifacts.

## Configuration

Graph configuration should remain narrow and operational.

Target config fields:

```json
{
  "graph": {
    "toolsetRoot": "path/to/toolset",
    "databasePath": ".gmloop/graph.db",
    "embeddings": {
      "enabled": true,
      "provider": "local",
      "modelCacheDir": ".gmloop/models"
    }
  }
}
```

Rules:

- CLI flags override config.
- Defaults should support project-only mode with no graph config.
- Avoid exposing internal storage strategy knobs.
- Keep embedding configuration local and explicit.
- Config must not blur workspace ownership.

## Test Plan

Semantic tests:

- graph-qualified IDs are stable and disambiguate same-named project/toolset symbols.
- graph projection creates expected nodes and edges from semantic project-index payloads.
- duplicate or misleading resource/script/function nodes are avoided or modeled with clear containment.
- cross-graph `uses_toolset` edges are created only when project-local ownership does not exist.
- search returns relevant exact, alias, lexical, and embedding-reranked results.
- context bundles are compact, deterministic, and provenance-rich.
- summaries and snippets are deterministic and size-bounded.
- rebuilds update changed rows and remove stale deleted-file rows.
- schema migration or rebuild behavior is explicit and tested.
- doctor reports storage, schema, freshness, integrity, embedding, and root-path state.
- visualization export returns bounded data and excludes vectors/full source.

CLI tests:

- graph commands register in the public CLI catalog.
- `--json` output is stable for index/search/symbol/context/neighbors/usages/doctor/visualize.
- config, CLI flag, and default precedence are correct.
- graph doctor reports missing roots, stale DBs, and embedding/model issues clearly.
- graph visualize reuses semantic export data and writes the requested output path.
- generated visualization output contains valid embedded data or references expected assets.

MCP tests:

- graph commands become MCP tools through CLI catalog generation.
- tool input maps back to CLI argv correctly.
- nonzero graph commands surface `isError: true`.
- graph resources return the same semantic data contracts as CLI JSON mode.

UI/visual verification:

- graph explorer renders empty, loading, stale, error, small graph, and large graph states.
- search, filters, focus, zoom/pan, and scope toggles work.
- node and edge styling communicates kind/type without relying on color alone.
- controls are keyboard reachable and have accessible names.
- mobile and narrow viewport layouts remain usable.

Validation commands:

```bash
pnpm run build:ts
pnpm run lint:quiet
pnpm run test:semantic
pnpm run test:cli
pnpm run test:mcp
```

## Non-Goals

- A second parser or project scanner just for graph indexing.
- Raw SQL access from CLI, MCP, UI, lint, refactor, or transpiler workspaces.
- MCP-only graph commands.
- Full-project source dumps as context.
- Network embedding providers by default.
- User-facing switches for internal graph storage strategies.
- Editable graph visualization. Mutations must go through CLI/refactor/project-resource commands.
- Browser automation primitives inside `@gmloop/mcp`; those belong to browser automation tools.

## Implementation Direction

Recommended sequence:

1. Keep semantic graph facts and query APIs authoritative.
2. Improve graph fidelity before adding presentation polish.
3. Ensure graph commands and MCP catalog exposure stay generated from CLI metadata.
4. Use visualization export data as a stable contract between semantic and presentation layers.
5. Add UI and generated visualization improvements on top of that export contract.
6. Use graph doctor and tests to make storage/runtime/freshness failures explicit.

Each PR should close one concrete graph-index, retrieval, CLI/MCP, or visualization gap with focused tests. Broad rewrites, speculative graph categories, or UI-only fixes that hide incorrect semantic facts should be avoided.
