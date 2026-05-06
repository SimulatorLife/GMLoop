---
name: semantic-project-index
description: Use this skill when working on semantic analysis, scope tracking, symbol resolution, SCIP modeling, graph/search/context retrieval, or project index storage and query behavior.
---

# Semantic Project Index Skill

## Purpose

Use this skill when an agent is changing semantic analysis or project indexing.

The semantic target state is a robust, bounded-memory understanding layer for GameMaker projects:

- classify identifiers and scopes deterministically
- model definitions and references through SCIP-shaped data
- support linting, refactoring, transpilation, graph views, search, and AI-agent context retrieval
- scale to large projects without retaining monolithic aggregates
- preserve strict GameMaker semantics instead of generic JavaScript assumptions

This skill is target-state oriented. Refactor current structures when they block correctness, typing, DRY design, or performance.

## Ownership

Semantic owns:

- scope and symbol analysis
- identifier classification
- resource and project graph facts
- SCIP-compatible symbol occurrence data
- graph/search/context retrieval models
- project index construction and query interfaces
- bounded-memory index execution backends

Semantic does not own:

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

## Symbol Model

SCIP-shaped data is the canonical model for definitions and references.

- Use deterministic symbol names such as `gml/<kind>/<qualified-name>` when applicable.
- Distinguish local, `self`, `other`, `global`, built-in, resource, and script references.
- Preserve source ranges and enough occurrence metadata for navigation and refactor safety.
- Keep symbol identity independent of transient file ordering.
- Model unknown or unresolved symbols explicitly instead of pretending resolution succeeded.

## Storage And Query Strategy

Prefer bounded-memory execution.

- Stream large intermediate records instead of building one full-project object graph.
- Use temp-file chunking as the default low-risk spill strategy when memory growth is the problem.
- Consider SQLite or another established indexed store only behind a clear benchmark or query need.
- Keep storage adapters behind typed interfaces so semantic facts remain the canonical model.
- Avoid exposing internal storage choices as user-facing configuration.

## AI Agent Context Retrieval

Semantic graph and search APIs should help automation tools build and modify GameMaker games.

- Return compact, ranked, explainable context rather than huge raw project dumps.
- Preserve enough provenance for agents to cite files, symbols, and resource metadata.
- Prefer deterministic query results so repeated agent runs are stable.
- Keep retrieval APIs domain-specific to GameMaker projects and resources.

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

- Full-project aggregates retained longer than needed.
- User-facing knobs for internal indexing backends.
- Duplicated symbol resolution in lint, refactor, transpiler, or CLI.
- Semantic code that mutates source files.
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass typing.
