---
name: semantic-project-index
description: Use this skill when working on semantic analysis, scope tracking, symbol resolution, SCIP modeling, graph/search/context retrieval, or project index storage and query behavior.
---

# Semantic Project Index Skill

## Purpose

Use this skill when an agent is changing semantic analysis or project indexing.

The semantic-analysis system is the authoritative source of semantic facts for a specific project revision. Downstream systems, including the LSP, linter, refactor engine, codemods, transpiler, hot-reload system, project graph, and CLI tools, must consume these shared semantic facts rather than independently inferring or approximating code meaning.

The semantic target state is a robust, understanding layer for GameMaker projects:

- fast indexed lookup, bounded-memory, incremental, and deterministic
- one canonical semantic model shared by all consumers (LSP, graph-index visualization, refactor/codemods, etc.)
- classify identifiers and scopes deterministically
- allows for safe semantic rename and codemods
- explicit uncertainty rather than guessed resolution
- support linting, refactoring, transpilation, graph views, search, and AI-agent context retrieval
- scale to large projects without retaining monolithic aggregates
- preserve strict GameMaker semantics; must support every valid GML declaration, scope, ownership form, reference form, etc.
- invalidation must trigger verification or recomputation only for results whose inputs may have changed, without eagerly deleting or rebuilding every transitive dependent
- zero-reanalysis compatible warm starts utilizing cached manifest entry metadata (such as content hashes and sizes) when modification times (mtime) match the cache
- Inheritance changes must propagate through indexed direct relationships, recomputing affected effective interfaces and continuing only where their externally relevant semantic output changes
- Snapshot and derived-cache retention must be bounded, with completed or cancelled requests releasing their references and obsolete revisions becoming reclaimable. Unchanged data may be shared across revisions, but unexpectedly retained snapshots and caches must be observable
- Progressive semantic availability must be published as separate immutable snapshots rather than mutations to existing snapshots. Each request must pin one snapshot identified by project revision, analysis generation, tier, capabilities, coverage, and overlay versions for its full duration
- The system must distinguish source and project errors, limitations or uncertainty in semantic analysis, and failures in the semantic service or persistent cache. Every issue must identify its origin, affected capabilities, safety implications, source location where applicable, and whether the result is conservative or blocks an operation

This skill is target-state oriented. Refactor the current codebase's implementation/structures when they block correctness, typing, DRY design, or performance.

## Ownership

Semantic owns:

- scope and symbol analysis
- identifier classification
- resource and project graph facts
- SCIP-compatible symbol occurrence data
- graph/search/context retrieval/query models/interfaces
- bounded-memory index execution backends

Semantic does **not** own:

- syntax parsing
- formatting layout
- lint rule messages or autofix policy
- codemod edit application
- JavaScript emission
- CLI command parsing
- UI presentation

Semantic may provide facts to other workspaces, but it should not perform their policy decisions.

## Working Approach

Before editing:

1. Identify the semantic fact or query being added or corrected.
2. Confirm whether the fact is file-local, project-wide, or resource-metadata-aware.
3. Search for duplicate scope, symbol, graph, and index behavior.
4. Decide whether the data can stream, chunk, or be queried lazily.
5. Add tests for correctness and scale-sensitive behavior where practical.

Implementation should:

- keep canonical semantic data independent of storage backend
- use precise domain types for symbols, occurrences, scopes, resources, and graph edges
- keep indexing deterministic at the output level
- avoid unbounded maps, arrays, caches, and snapshots for large projects
- release temporary data as soon as downstream phases no longer need it
- use established storage or indexing libraries where they reduce risk and are justified by benchmarked needs

## Storage And Query Strategy

Prefer bounded-memory execution.

- Stream large intermediate records instead of building one full-project object graph.
- Keep storage adapters behind typed interfaces so semantic facts remain the canonical model.
- Avoid exposing internal storage choices as user-facing configuration.

## AI Agent Context Retrieval

Semantic graph and search APIs should help automation tools build and modify GameMaker games.

- Return compact, ranked, explainable context rather than huge raw project dumps
- Preserve enough provenance for agents to cite files, symbols, and resource metadata
- Prefer deterministic query results so repeated agent runs are stable
- Keep retrieval APIs domain-specific to GameMaker projects and resources

## Testing Expectations

Add or update tests for:

- scope resolution and shadowing
- definitions and references
- resource graph extraction
- unresolved and ambiguous symbols
- incremental or chunked indexing behavior
- query determinism
- memory-sensitive paths when a bug involved scale

Use synthetic projects in tests when protected golden fixtures are not required.

## Checklist

Before finishing semantic work, verify:

1. The change exposes facts rather than downstream policy.
2. Symbol and scope modeling matches GameMaker behavior.
3. Data structures are bounded or justified.
4. Storage choices are hidden behind typed interfaces.
5. Tests cover correctness and relevant scale risks.
6. Consumers do not reach into semantic internals unnecessarily.

## Prohibited Patterns

- Full-project aggregates retained longer than needed
- User-facing knobs for internal indexing backends
- Duplicated symbol resolution across the project/workspaces
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass typing
- Unnecessary re-analysis of unchanged files or symbols
