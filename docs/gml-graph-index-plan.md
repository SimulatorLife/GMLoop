# Document and Implement the Dual-Root GML Graph Index

## Summary

Create a new standalone design doc at [docs/gml-graph-index-plan.md](/Users/henrykirk/GMLoop/docs/gml-graph-index-plan.md) containing the exact approved plan, then implement that plan by adding a semantic-owned dual-root graph index backed by SQLite, exposed through new CLI graph commands and thin MCP wrappers/resources.

The implementation must preserve existing ownership boundaries:

- `@gmloop/semantic` owns indexing, graph projection, search, summaries, embeddings, and query APIs
- `@gmloop/cli` owns human-facing commands and JSON output
- `@gmloop/mcp` stays a thin wrapper over the CLI command catalog plus read-only resources
- existing semantic project indexing remains the analysis intake, not replaced by a parallel indexer

## Documentation Changes

- Create [docs/gml-graph-index-plan.md](/Users/henrykirk/GMLoop/docs/gml-graph-index-plan.md) with the exact approved plan text and the same major sections:
  - Summary
  - Key Changes
  - Test Plan
  - Assumptions and Defaults
- Update [docs/target-state.md](/Users/henrykirk/GMLoop/docs/target-state.md) with a short cross-reference that the concrete graph-index design now lives in the new plan doc and that graph/search/context retrieval is owned by `@gmloop/semantic`
- Update [docs/examples/gmloop.json](/Users/henrykirk/GMLoop/docs/examples/gmloop.json) to show the new `graph` config section for `toolsetRoot`, `databasePath`, and local embedding settings
- Update [src/mcp/README.md](/Users/henrykirk/GMLoop/src/mcp/README.md) to mention the new graph leaf commands and graph-backed MCP resources

## Implementation Changes

### 1. Add a semantic graph-index domain

Add a new `src/semantic/src/graph-index/` namespace and export it from [src/semantic/src/index.ts](/Users/henrykirk/GMLoop/src/semantic/src/index.ts). This domain owns:

- dual-root graph descriptors and config normalization
- SQLite schema creation and migration
- projection from current `buildProjectIndex(...)` output into graph tables
- deterministic summaries and declaration snippets
- local embedding generation and vector storage
- query APIs for search, symbol lookup, context bundles, neighbors, usages, and doctor output

Use `node:sqlite` as the SQLite runtime behind a semantic-owned adapter seam. Do not add a second parser/indexer layer. Treat the runtime as experimental at the Node level: document that status clearly and surface the active runtime/integrity state through graph doctor output rather than leaving it implicit.

### 2. Define the graph model and persistent schema

Implement the SQLite schema inside semantic with explicit versioned migration support and tables for:

- graphs
- files
- nodes
- edges
- aliases
- embeddings
- index_state
- FTS5 virtual table for searchable node text

Node IDs must be graph-qualified and stable, using current SCIP identifiers where possible:

- `project::gml/script/<name>`
- `toolset::gml/script/<name>`
- `project::resource::<resource-path>`
- `project::file::<relative-path>`

Keep SCIP as the canonical symbol identity and use the graph-qualified ID as the retrieval key. Schema upgrades should prefer explicit in-place migrations where feasible and fall back to rebuilds only when a safe migration path is not available.

### 3. Build dual-root indexing on top of the existing semantic project index

Implement a graph build flow that:

- resolves the active project root from `--path` or `gmloop.json`
- resolves an optional toolset root from CLI/config
- runs the existing semantic project indexing for each root independently
- projects both snapshots into one SQLite catalog
- emits cross-graph `uses_toolset` edges only when a project symbol/resource reference resolves uniquely to the toolset and is not project-local
- uses file/content hashes and graph-local persistence so unchanged graph slices can be preserved across rebuilds instead of resetting the whole database every time

Do not change formatter/lint/refactor ownership. This is semantic analysis plus retrieval.

### 4. Add summaries, snippets, and local embeddings

Implement deterministic summary generation in semantic:

- prefer doc-comment first sentence
- otherwise synthesize from symbol kind, name, owning file/resource, and relationship counts

Store bounded declaration snippets only, never full-file dumps.

Implement local-only embeddings in semantic with a concrete default provider and a typed provider seam. The first version should:

- use a small local sentence model
- cache model assets under a project-local or config-controlled directory
- embed normalized node text and query text
- store vectors as binary blobs in SQLite
- rerank lexical candidates in Node rather than requiring SQLite vector extensions

### 5. Add the public semantic query API

Export explicit graph APIs from semantic, including:

- build/open graph index
- search
- symbol lookup
- context bundle lookup
- neighbors
- usages
- doctor

The CLI and MCP layers must call these public semantic APIs rather than issuing raw SQL themselves.

### 6. Add CLI graph leaf commands

Add new CLI leaf commands under a `graph` suite:

- `graph index`
- `graph search`
- `graph symbol`
- `graph context`
- `graph neighbors`
- `graph usages`
- `graph doctor`

Requirements:

- support `--path`, `--toolset-root`, `--config`, `--json`
- support `--depth` where applicable
- support `--limit` for search
- support `--rebuild` for forced rebuilds
- return concise human output by default and stable JSON envelopes in `--json` mode

Update the CLI command catalog so these are first-class discoverable commands.

### 7. Extend MCP through the CLI catalog and graph resources

Update the MCP workspace so the new CLI graph leaf commands become generated MCP tools automatically, consistent with the existing MCP direction.

Also add read-only graph resources such as:

- `gm://graph/overview`
- `gm://graph/project/overview`
- `gm://graph/toolset/overview`
- `gm://node/<id>`
- `gm://context/<id>?depth=2`
- `gm://neighbors/<id>?depth=2`

Use the same semantic query layer for both CLI and MCP outputs so the data shape stays identical.

### 8. Add config support

Extend the semantic/CLI config path so `gmloop.json` can carry a new `graph` section with:

- `toolsetRoot`
- `databasePath`
- `embeddings.enabled`
- `embeddings.provider`
- `embeddings.modelCacheDir`

CLI flags override config values. Defaults should keep project-only mode working with no extra configuration.

## Test Plan

### Semantic tests

- dual-root builds create separate `project` and `toolset` graphs in one DB
- graph-qualified IDs remain stable and disambiguate same-named symbols
- projection creates expected nodes and edges from current project-index payloads
- cross-graph `uses_toolset` edges are created only when project-local ownership does not exist
- FTS lookup returns relevant symbols for vague lexical queries
- embedding rerank changes candidate ordering for semantically related queries
- summaries and snippets are deterministic and size-bounded
- rebuilds update changed rows and remove stale deleted-file rows
- schema migration upgrades supported historical schemas in place where defined and otherwise triggers a clean rebuild path
- doctor reports runtime/integrity state, including SQLite runtime details, quick-check status, and foreign-key violations

### CLI tests

- graph commands register in the public CLI catalog
- `--json` output is stable for search/symbol/context/neighbors/usages/doctor
- config, CLI flag, and default precedence for `toolsetRoot` and DB path are correct
- graph doctor reports missing roots, stale DBs, and embedding/model issues clearly

### MCP tests

- CLI graph commands become MCP tools with no hand-authored per-command registration
- tool input maps back to CLI argv correctly
- nonzero CLI graph commands surface `isError: true`
- graph resources return the same semantic data contracts as CLI JSON mode

### Validation commands

- `pnpm --filter @gmloop/semantic run build:types`
- `pnpm --filter @gmloop/cli run build:types`
- `pnpm --filter @gmloop/mcp run build:types`
- `pnpm run test:semantic`
- `pnpm run test:cli`
- `pnpm run test:mcp`
- `pnpm run build:ts`
- `pnpm run lint:quiet`

## Assumptions and Defaults

- The plan document is a new standalone file at [docs/gml-graph-index-plan.md](/Users/henrykirk/GMLoop/docs/gml-graph-index-plan.md).
- `@gmloop/semantic` is the correct owner because this feature is project-aware analysis and retrieval, not formatting, lint fixing, or refactor edit planning.
- SQLite is authoritative for retrieval in v1, while existing semantic project indexing remains the analysis intake.
- The default DB path is project-local, under `.gmloop/`.
- The toolset root is optional.
- Embeddings are local-only in v1 and should not require a network provider.
- The first implementation should favor full dual-root rebuilds projected from the current semantic index, with file/content hashes and schema support laid out so more incremental updates can be added later without reworking the API.
