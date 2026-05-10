# Target State & Architecture Plan

This document synthesizes the target state for the GameMaker Language parser project, covering the formatter/linter split, semantic analysis, project-wide codemod execution, bounded-memory streaming, transpilation, and hot-reload infrastructure.

## 1. Summary & Objectives

1. **Strict Separation of Concerns**: Split responsibilities into a Prettier-plugin formatter-only workspace (`/format`), an ESLint v9 language+rules workspace (`/lint`), a refactor/codemod workspace (`/refactor`), and shared core utilities (`/core`).
2. **Deterministic Formatting**: Keep the formatter deterministic and non-semantic. A Prettier plugin must not change formatting based on semantic meaning or program behavior. The formatter may render or reflow comments but must not interpret comment text to infer documentation structure or upgrade plain comments into documentation comments.
3. **Linter with Auto-Fixes**: Any non-layout, single-file-scoped rewrites should be handled by the linter's (`/lint`) rules with explicit diagnostics and optional `--write`. Lexical canonicalization (for example, operator aliases and numeric literal formatting) is permitted in the formatter, but syntactic or semantic rewriting is not. Any structural or semantic fixes must live in the `lint` workspace.
4. **Robust Semantic Analysis**: Implement a semantic layer that annotates the parse tree to power linting, refactoring, and transpilation, using the Sourcegraph Code Intelligence Protocol (SCIP) as the canonical symbol model.
5. **Bounded-Memory Refactors**: Run large-project semantic indexing and codemod pipelines without retaining monolithic project-wide aggregates in memory. The target architecture uses bounded-memory streaming with spill-to-disk backends and whole-plan validation only where correctness requires it.
6. **Live Hot-Reloading**: Enable true hot-loading of GML code, assets, and shaders without restarting the game by transpiling GML to JavaScript on demand and injecting it via a runtime wrapper.

Concrete graph-index design and implementation details now live in [docs/gml-graph-index-plan.md](gml-graph-index-plan.md). Graph/search/context retrieval is owned by `@gmloop/semantic`.

## 2. Workspace Ownership Boundaries

### 2.1 General Ownership

- **Formatter (`/format`)**: Layout-only printing, indentation, wrapping, spacing, semicolon layout, print-width wrapping, and logical-operator style rendering. Must not synthesize or normalize semantic content. Lexical canonicalization is permitted, but syntactic and semantic rewriting is not. Any structural or semantic fixes must live in the `lint` workspace.
- **Linter (`/lint`)**: Semantic and content rewrites, synthetic tag generation, legacy prefix or tag normalization, default placeholder comment cleanup, and local single-file diagnostics and autofix rewrites.
- **Refactor (`/refactor`)**: Codemod and migration transforms, explicit rename or refactor transactions, cross-file edits, metadata edits, impact analysis, hot-reload validation, project-wide identifier indexing, rename safety, hoist-name generation, and all other project-aware functionality.
- **Core (`/core`)**: Shared doc-comment helpers, AST metadata utilities, and normalization primitives.
- **CLI Watcher (`/cli`)**: Monitors the filesystem, coordinates the transpilation pipeline, emits telemetry, and manages the WebSocket server.
- **Transpiler (`/transpiler`)**: Parses GML via ANTLR4, converts GML AST to JavaScript, and generates patch objects.
- **Runtime Wrapper (`/runtime-wrapper`)**: Injected into the browser; maintains a hot registry of patched functions and overrides GML dispatchers.

### 2.2 Doc-Comment Ownership

- **Lint (`gml/normalize-doc-comments`)** owns legacy prefix or tag normalization, promotion of plain comments into doc-comment form (for example, `// description ...` to `/// @description ...`), `@description` promotion and cleanup (including removal of empty `/// @description` at top-of-file or function doc blocks), `@param` separator normalization (for example, `name - description` to `name description`), and function-doc tag synthesis.
- **Lint (`gml/normalize-banner-comments`)** owns decorative banner normalization, including line-banner canonicalization, decorative block-banner collapse, non-doc-comment triple-slash normalization, and removal of decorative-only separators.
- **Format** owns rendering and spacing of already-existing or already-normalized doc comments and comment placement or layout that does not change text content. The formatter may decide comment placement or layout when that only affects whitespace, indentation, line breaking, or attachment. The formatter must not rewrite comment text, infer documentation semantics from raw comment text, or promote ordinary comments into documentation comments.
- **Core** owns shared doc-comment helpers used by lint and format.
- **Clarification**: Promotion of a plain comment into documentation form is a content-aware rewrite because it requires interpreting comment text to infer documentation structure. Such transformations must always live in lint rules, never in the formatter.

_Migration rule_: Do not add new doc-comment content mutation logic in formatter printers or transforms. Any new doc-comment synthesis, promotion, or tag or content rewrite must be implemented as lint rule behavior.

### 2.3 Lint/Refactor Overlap Resolution

1. `/lint` owns diagnostic reporting and local repairs. It uses a single-file `fix` model for changes that are safe within the local scope.
2. `/refactor` owns global transactions. It handles atomic cross-file edits, metadata updates (`.yy`, `.yyp`), structural migrations, and project-wide rename planning.
3. If a lint rule requires a change that impacts the project graph or metadata, it should report the diagnostic and point the user to a refactor command rather than attempting a multi-file autofix through ESLint.
4. Lint must not contain dormant project-index builders, project-root registries, rename-planning helpers, or other project-aware infrastructure in its source tree; those implementations belong exclusively in `/refactor`.
5. No duplicate capability logic is allowed across lint and refactor surfaces.
6. **`globalvar` Migrations**: The lint workspace must only provide a read-only rule to report deprecated/legacy `globalvar` usage. It must **not** attempt to auto-fix this usage because rewriting `globalvar` to `global.` requires cross-file, project-aware edits to ensure correctness, which violate lint's single-file constraints. The specific task of fixing/refactoring `globalvar` to `global.` should be exclusively owned by the `refactor` workspace as a standalone codemod.

### 2.4 Refactor Tool (Codemod / Migration Transforms)

- **Purpose**: Project-wide, sometimes project-aware rewrites that are neither formatting nor small local lint fixes.
- **Scope**: Multi-file changes, API migrations, mechanical refactors, structural rewrites, workspace-wide rename or update operations, and project-aware edit planning.
- **Behavior**: Explicit and opt-in, typically run as a one-off or scripted step; may use project index and symbol information; may be destructive by design but must remain controlled and deterministic at the output level.
- **Order in pipeline**: Project-wide write workflows run codemod, then lint `--write`, then formatter, followed by typecheck and tests as separate validation steps.

### 2.5 Non-Goals

To prevent scope creep and future drift, the following are explicitly out of scope:

- **Formatter does not perform**: Syntax repair, project-aware rewrites, structural refactors, semantic transformations, or promotion of plain comments into documentation comments.
- **Lint does not perform**: Cross-file edits, auto-fixing `globalvar` to `global.`, metadata updates, project-wide indexing, rename safety, hoist-name generation, or whole-project edit planning.
- **Refactor does not**: Run automatically on save.

## 3. Formatter & Linter Contracts

### 3.1 Handling Malformed GML (Two-Tier Workflow)

Use a two-tier workflow: format only when parse succeeds, and run lint in two phases so safe fixes can still run on malformed code.

- **Phase A: Token-based or tolerant fixes**: Runs even on malformed code and applies local, unambiguous rewrites such as `&&` to `and` or `#define` to `#macro`.
- **Phase B: AST-based lint fixes**: Runs only if parse succeeds and performs semantic rules and fixers.
- **Formatter**: Requires a valid parse; if parse fails, it errors and does not change files. The formatter must never attempt recovery or fallback printing. Lint Phase A may still apply safe fixes even when parse fails.

### 3.2 Formatter Boundary & Allowlist

1. Formatter may only perform layout and canonical rendering transforms such as indentation, wrapping, spacing, parenthesis rendering, trailing delimiters, final newline insertion, and `logicalOperatorsStyle` alias canonicalization.
   - _Parentheses_: Formatter may remove redundant syntactic constructs when they are provably unnecessary, but must not synthesize new syntax for readability or restructuring.
   - _Nested ternaries_: When a ternary expression appears inside the true branch of another ternary, parentheses are required and must be preserved (`cond ? (inner ? a : b) : c`). Formatters and autofixers must never emit `cond ? inner ? a : b : c`.
   - _Numeric literals_: Canonical numeric literal normalization such as `.5` to `0.5` and `5.` to `5` is formatter-owned zero-normalization.
   - _Numeric literal ownership clarification_: Rewriting existing decimal literals that only differ by missing leading or trailing zeros remains formatter-owned behavior. Lint rules such as `optimize-math-expressions` must not rewrite those literals in place. Exception: when a lint math optimization folds an expression and synthesizes a new literal result, the synthesized literal should already be emitted in formatter-normalized form to avoid follow-up churn.
2. Formatter must not perform semantic or content rewrites or syntax repair.
3. Invalid code handling remains strict: on parse failure the formatter fails and does not mutate source.

### 3.3 Public API & Internal Implementation Contracts

- **ESLint v9 language wiring**: `Lint.plugin.languages.gml` implements the ESLint v9 `Language` interface.
- **Recommended config**: `Lint.configs.recommended` is a complete flat-config preset.
- **AST, token, and comment contract**: Output model is ESTree-compatible plus explicit GML extension node types. `range` is `[start, end)` in UTF-16 code-unit offsets.
- **Parse errors and recovery**: Language parse never throws uncaught exceptions to ESLint. Parse failures are returned through ESLint v9’s documented language parse-failure channel.
- **Project context**: CLI `--path <path>` accepts a target `.gml` file, project directory, or `.yyp` path. Lint rules still remain single-file analyzers and do not receive project-aware registries, semantic indexes, rename-planning services, or cross-file safety services.

### 3.4 Rule System Contracts

- **Language services**: Rules access language-specific metadata through `context.sourceCode.parserServices.gml`.
- **Unsafe to fix reporting**: Shared helper required for rules that might be unsafe: `messageId: "unsafeFix"` with stable prefix `[unsafe-fix:<reasonCode>]`.
- **Fixer edit boundary**: Fixers are single-file only and must not perform cross-file writes. Project-aware functionality and cross-file edits belong in the `refactor` workspace.

### 3.5 Implementation Status & Audit Findings (Snapshot 2026-02-17)

- Formatter and linter split migration is largely complete at runtime.
- Remaining work includes isolating dormant migrated semantic transform modules from formatter workspace exports and continuing to push any project-aware edit planning into `/refactor` rather than `/lint`.
- Any existing functionality in the `format` workspace that goes beyond pure layout formatting should be identified and migrated into the `lint` or `core` workspaces.

## 4. Semantic Analysis, Symbol Indexing, and Storage

### 4.1 Semantic Analysis Requirements

ANTLR4 provides syntactic structure but no meaning. A semantic layer annotates the parse tree so downstream systems can make correct decisions about symbol resolution, type consistency, function dispatch, scope boundaries, resource references, lint diagnostics, codemod safety, and transpilation behavior.

### 4.2 Identifier Resolution Policy

Semantic annotations should classify identifiers deterministically:

1. **Local scope**: Emit as bare identifiers in JavaScript.
2. **`self` fields**: Emit `self.<name>`.
3. **`other` fields**: Emit `other.<name>`.
4. **`global` fields**: Emit `<GLOBALS>.<name>`.
5. **Built-in functions or constants**: Emit shimmed references.
6. **Script calls**: Emit through the hot registry or wrapper thunk.

### 4.3 Canonical Symbol Index (SCIP)

Use the Sourcegraph Code Intelligence Protocol (SCIP) as the single canonical representation of symbol definitions and references.

- **Standardized and compact**: Suitable for tooling, linting, refactoring, and rapid reload cycles.
- **Deterministic symbol naming**: Use a URI-like scheme such as `gml/<kind>/<qualified-name>` (for example, `gml/script/scr_damage_enemy`).
- **Minimal hot-reload queries**: Read definition occurrences for a file, collect reference occurrences for dependents, and recompile only the affected symbols.

### 4.4 Storage Strategy: Canonical Model vs Execution Backend

SCIP remains the canonical symbol model. Storage and execution, however, should use a hybrid bounded-memory architecture rather than a single always-in-memory or always-SQL design.

- **Canonical model**: Symbol definitions and references are represented in SCIP-shaped data.
- **Execution backend**: Large semantic-index and codemod payloads use bounded-memory processing with spill-to-disk backends.
- **Default backend**: Temp-file chunking is the default implementation because it reduces memory quickly with lower implementation risk.
- **Optional backend**: SQLite remains a supported direction for indexed query workloads, but only behind a benchmark gate and only if it materially improves throughput or memory.
- **Relational projections**: When tooling benefits from relational or graph queries, semantic results may also be projected into SQLite-style `nodes` and `edges` tables without changing the canonical symbol model.

## 5. Semantic Index & Codemod Streaming Architecture

### 5.1 Problem Statement

Running the refactor codemod pipeline on a large real project can exceed 15 GB of memory and take a very long time.

Example workload:

- `pnpm run cli -- fix --path GameMakerStudio2/InterplanetaryFootball`

Root-cause pattern:

- The semantic index and codemod planner retain very large project-wide in-memory aggregates for too long.
- Some containers are unbounded or effectively unbounded for large projects.
- Processing is partially concurrent, but results are still merged into monolithic structures that stay alive across phases.

This plan targets structural memory reduction, not heap-size scaling.

### 5.2 Goals and Non-Goals

#### 5.2.1 Goals

1. Reduce peak RSS and heap by avoiding full-project in-memory aggregates where possible.
2. Improve throughput on large projects by using bounded-memory streaming and chunked processing.
3. Preserve codemod correctness checks that need whole-plan visibility.
4. Keep resulting codemodded GML semantically equivalent to current behavior.
5. Keep the architecture deterministic at the output level while allowing internal processing-order differences.

#### 5.2.2 Non-Goals

1. Increasing `max-old-space-size` as the primary solution.
2. Introducing broad user-facing configuration for internal pipeline internals.
3. Rewriting unrelated formatter or linter architecture.
4. Adding vector-database-style retrieval to this workflow.

### 5.3 Confirmed Hotspots (Current Code)

#### 5.3.1 Semantic Index Build Aggregation

Primary seams:

- `src/semantic/src/project-index/builder.ts`
- `buildProjectIndex`
- `processProjectGmlFilesForIndex`
- `createProjectIndexResultSnapshot`

Observed pattern:

- Large identifier occurrence collections grow throughout the build lifecycle.
- Snapshot creation happens after large in-memory accumulation.

#### 5.3.2 Scope Symbol Indexes and Caches

Primary seam:

- `src/semantic/src/scopes/scope-tracker.ts`

Observed pattern:

- Symbol-to-scope indexes and lookup caches can remain live with very large cardinality.

#### 5.3.3 Codemod Edit and Overlay Retention

Primary seams:

- `src/refactor/src/refactor-engine.ts`
- `src/refactor/src/workspace-edit.ts`
- `src/refactor/src/codemods/naming-convention/naming-convention-codemod.ts`

Observed pattern:

- Workspace edits and intermediate file-content overlays can accumulate across many files.
- Existing rename chunking helps, but does not fully bound all retained state.

#### 5.3.4 Refactor CLI Index Bootstrapping

Primary seam:

- `src/cli/src/commands/refactor.ts`

Observed pattern:

- End-to-end `refactor codemod --write` latency includes the semantic project-index build, so forcing `buildProjectIndex` down to `concurrency: { gml: 1 }` turns large codemod runs into an avoidable serial bottleneck before refactor planning even begins.

### 5.4 Option Set and Trade-Offs

#### 5.4.1 Option A: Temp-File Chunking (Default Recommendation)

Design:

- Stream heavy intermediate data to temporary chunk files.
- Keep only bounded hot windows in memory.
- Use append-only chunk records plus a compact in-memory offset index.

Pros:

1. No heavy runtime dependency required.
2. Lowest implementation risk and fastest path to impact.
3. Strong memory-reduction potential by limiting live aggregates.
4. Straightforward cleanup and failure-path handling.

Cons:

1. Less expressive query capability than SQL.
2. Requires careful chunk and index format design.
3. Can add parsing overhead if the format is too verbose.

Best fit:

- First implementation pass for immediate throughput and memory gains.

#### 5.4.2 Option B: SQLite Backing Store (Optional)

Design:

- Persist index or edit-plan structures to SQLite.
- Query through indexed tables instead of large in-memory maps.

Pros:

1. Strong query flexibility and mature indexing support.
2. Better random-access patterns than plain chunk files.
3. Transactional behavior can simplify consistency guarantees.

Cons:

1. Additional dependency and schema lifecycle complexity.
2. Migration and versioning overhead.
3. Potential write amplification and tuning requirements.

Best fit:

- Follow-up only if benchmarks show clear wins over the temp-file backend.

#### 5.4.3 Option C: Hybrid Bounded-Memory Plus Spill (Target Architecture)

Design:

- Use a unified storage interface with a bounded in-memory hot cache.
- Spill cold or heavy data to a disk backend.
- Keep temp files as the default backend and support SQLite as an optional backend.

Pros:

1. High practical memory reduction with good throughput.
2. Incremental migration path and low rollback risk.
3. Backend swap flexibility without changing planner logic.

Cons:

1. More engineering than a single hardcoded backend.
2. Requires clear lifecycle and ownership boundaries.

Best fit:

- Long-term maintainable architecture that still delivers short-term gains.

### 5.5 Recommended Architecture and Design Principles

Use Option C, implemented in phases:

1. Implement Option A first as the default backend.
2. Keep the storage and query contract backend-agnostic.
3. Add Option B only if benchmark thresholds are met.

Design principles:

1. Keep whole-plan conflict checks in memory when required.
2. Stream large occurrence and edit payloads.
3. Release buffers immediately after commit boundaries.
4. Bound caches with explicit size limits and eviction policy.

### 5.6 Phased Implementation Plan

#### 5.6.1 Phase 0: Measurement and Guardrails

Objective:

- Make memory and throughput regressions visible before refactoring internals.

Tasks:

1. Add fix-command stage telemetry in `src/cli/src/commands/fix.ts`.
2. Add semantic-index phase telemetry in `src/semantic/src/project-index/builder.ts`.
3. Add codemod queue and overlay telemetry in `src/refactor/src/refactor-engine.ts`.
4. Add `WorkspaceEdit` size counters in `src/refactor/src/workspace-edit.ts`.
5. Include high-water memory snapshots, not only deltas.

Deliverables:

1. Stage-level and phase-level memory and runtime metrics for the fix workflow.
2. Baseline report for the InterplanetaryFootball run.

#### 5.6.2 Phase 1: Semantic Identifier Streaming

Objective:

- Eliminate monolithic in-memory identifier accumulation.

Tasks:

1. Introduce `IdentifierSink` in the semantic project-index domain.
2. Replace direct global-map aggregation with sink writes.
3. Implement a temp-file chunk sink with bounded flush thresholds.
4. Build a compact chunk-metadata index for efficient lookup.
5. Add an LRU read-through page cache with an explicit cap.
6. Bound or replace unbounded lookup-cache patterns in scope tracking where safe.

Correctness constraints:

1. Snapshot output semantics must remain unchanged.
2. Query responses must remain semantically equivalent.

#### 5.6.3 Phase 2: Codemod Plan and Edit Streaming

Objective:

- Prevent unbounded edit and content-overlay growth during codemods.

Tasks:

1. Refactor `WorkspaceEdit` into segment-based or spillable edit storage.
2. Update `applyWorkspaceEdit` to process file-batched transactions.
3. Release per-file buffers immediately after apply.
4. Keep global preflight validation for rename conflicts and circular renames.
5. Execute heavy edit materialization in bounded chunks.
6. Limit dry-run overlay retention by using temp snapshots.

Correctness constraints:

1. Preflight validation must still see the complete rename plan.
2. Final transformed GML content must remain semantically equivalent.

#### 5.6.4 Phase 3: Optional SQLite Backend and Benchmark Gate

Objective:

- Evaluate whether SQLite materially improves throughput or memory.

Tasks:

1. Add a `StorageBackend` contract with `TempFileBackend` and `SQLiteBackend`.
2. Run A/B benchmarks on InterplanetaryFootball and fixture profile suites.
3. Keep the temp-file backend as default unless thresholds are met.

Adoption thresholds:

1. At least 20 percent wall-clock improvement, or
2. At least 25 percent max-RSS reduction,
3. With no correctness regressions.

### 5.7 Correctness and Determinism Strategy

Some checks require whole-plan visibility and should remain whole-plan:

1. Circular rename detection.
2. Duplicate target-name collision detection.
3. Cross-file consistency preflight checks.

Streaming-safe components:

1. Heavy occurrence-payload storage.
2. Batched edit application.
3. Temporary transformed-content storage.

Allowed variation:

1. Internal processing order may differ.
2. Final codemodded output must remain semantically equivalent.

### 5.8 Verification and Benchmarking Plan

#### 5.8.1 Functional and Regression Tests

1. `pnpm run test:semantic`
2. `pnpm run test:refactor`
3. Add targeted tests for spill and chunk behavior in semantic and refactor test suites.
4. Add failure-path tests to verify temp-artifact cleanup.

#### 5.8.2 Performance and Memory Validation

1. `pnpm run test:fixtures:profile`
2. `pnpm run test:fixtures:profile:deep-cpu`
3. `pnpm run cli -- fix --path GameMakerStudio2/InterplanetaryFootball`

Track:

1. Max RSS high-water mark.
2. Heap high-water mark.
3. Stage-by-stage duration.
4. Total wall-clock runtime.

Acceptance criteria:

1. Significant memory reduction versus baseline on InterplanetaryFootball.
2. Throughput improvement, or at minimum no throughput regression.
3. No semantic regressions in codemodded output.

### 5.9 Risk Register and Mitigations

1. Risk: Chunking introduces hidden ordering bugs. Mitigation: Keep whole-plan preflight checks and add chunk-order invariance tests.
2. Risk: Spill-format parsing overhead hurts throughput. Mitigation: Start with JSONL for implementation speed, then move to compact records only if profiling requires it.
3. Risk: Temp artifacts leak on interruption. Mitigation: Use scoped temp directories and `finally`-block cleanup with tests.
4. Risk: Cache bounds cause query thrash. Mitigation: Use telemetry-driven tuning and LRU policy with explicit caps.
5. Risk: Backend abstraction adds complexity. Mitigation: Keep the interface narrow and avoid speculative features.

### 5.10 Concrete Initial Work Slice

Implement first:

1. Phase 0 instrumentation.
2. Phase 1 `IdentifierSink` with temp-file chunk backend.
3. Bounded LRU around chunk reads.
4. Minimal Phase 2 change to make `WorkspaceEdit` spillable in large runs.

Defer until measured:

1. SQLite backend.
2. Any advanced compact binary serialization.

### 5.11 Summary Decision

Recommended path:

1. Build a hybrid architecture with temp-file chunking as default.
2. Keep whole-plan validations in memory.
3. Stream heavy payloads and apply edits in bounded batches.
4. Add SQLite only if the benchmark gate is met.

This path directly targets memory and runtime bottlenecks for large-project codemod runs while preserving correctness and maintainability.

### 5.12 Implementation Status (Current)

Implemented in this repository:

1. Semantic index supports an optional hybrid spill path through `identifierSink` in `buildProjectIndex`.
2. The default spill implementation is temp-file JSONL chunking with bounded in-memory tails.
3. Snapshot materialization reads identifier declaration and reference payloads through the sink when enabled, preserving output shape.
4. Sink telemetry reports appended and spilled record counters plus read-cache hit and miss metrics.
5. Semantic-index build captures high-water memory snapshots (`maxRss`, `maxHeapUsed`) in metrics metadata.
6. Scope-tracker caches use bounded eviction for lookup and identifier-resolution caches.
7. The `fix` command emits per-stage duration plus RSS and heap high-water telemetry.
8. Refactor codemod execution emits queue and overlay telemetry and supports a telemetry callback hook.
9. `WorkspaceEdit` tracks size and counter telemetry, including text bytes, high-water bytes, and touched-file count.
10. Refactor dry-run overlay supports temp-file spill via a storage backend when in-memory overlay bytes exceed a configured threshold.
11. Spill backends use collision-safe, digest-suffixed filenames to prevent key aliasing when sanitized path segments collide.
12. Codemod overlay spill-limit enforcement uses iterative draining instead of recursion to keep large-run behavior stack-safe.
13. Refactor spill backend handles lifecycle and failure paths explicitly: writes after dispose are rejected, reads after dispose return `null`, and externally removed spill files are treated as cache misses.
14. Semantic identifier sink handles lifecycle and failure paths explicitly: appends become no-ops after dispose, reads after dispose return empty results, and corrupted or missing spill files are treated as safe cache misses while retaining in-memory tails.
15. Overlay spill accounting caches per-file byte sizes to avoid repeated `Buffer.byteLength(...)` recomputation during threshold enforcement, and semantic sink spill-path cleanup uses direct path-to-record-key mappings to avoid `O(n)` scans.
16. Refactor codemod dry-run overlay spilling is backend-agnostic via `StorageBackend`, allowing callers to inject a backend while keeping temp-file spill as the default.
17. Codemod overlay telemetry reports total overlay entry count across both in-memory and spilled entries so high-water summaries remain accurate under heavy spill.

Current codemod overlay spill controls:

```ts
await engine.executeConfiguredCodemods({
	// ...existing request fields,
	dryRun: true,
	dryRunOverlaySpillThresholdBytes: 4 * 1024 * 1024,
	dryRunOverlayReadCacheMaxEntries: 32
});
```

Current semantic-index spill entry point:

```ts
await buildProjectIndex(projectRoot, undefined, {
	identifierSink: {
		enabled: true,
		flushThreshold: 256,
		retainedEntriesPerKey: 32,
		readCacheMaxEntries: 32
	}
});
```

Notes:

1. Temp-file spill remains the default backend for the hybrid path.
2. SQLite remains optional and deferred behind benchmark gates.

### 5.13 Benchmark Runbook and Current Blockers

Use this runbook for Option C acceptance checks and regression tracking.

Pre-flight:

1. Ensure the workspace is type-clean and lint-clean.
   - `pnpm run build:ts`
   - `pnpm run lint:quiet`
2. Ensure semantic and refactor correctness is green.
   - `pnpm run test:semantic`
   - `pnpm run test:refactor`

Profiling suites:

1. Standard fixture profile.
   - `pnpm run test:fixtures:profile`
2. Deep CPU fixture profile.
   - `pnpm run test:fixtures:profile:deep-cpu`

Real-project workload:

1. Run the fix workflow against the target project.
   - `pnpm run cli -- fix --path GameMakerStudio2/InterplanetaryFootball`
2. Capture telemetry emitted by:
   - `src/cli/src/commands/fix.ts` stage telemetry (duration plus RSS and heap high-water)
   - semantic project-index metrics metadata (`maxRss`, `maxHeapUsed`)
   - refactor codemod overlay telemetry (queue, overlay, spill, and cache counters)

## 6. Transpiler & Hot Reload Pipeline

### 6.1 Core Concept & Role of the Transpiler

The hot-reload system bypasses the static nature of the GameMaker HTML5 runner by providing a side-channel for JavaScript patches generated from fresh GML source. The ANTLR4-to-JavaScript transpiler generates JavaScript for changed GML every time a watched file changes, reproducing the code-generation logic necessary for hot reloads.

### 6.2 System Architecture

- **Dev server (Node.js/CLI)**: Watches GML files, transpiles them into JavaScript functions on demand, and broadcasts them as JSON patches via WebSocket.
- **Runtime wrapper (browser)**: Listens for patches via WebSocket and swaps function references in the GameMaker engine's internal registry.

### 6.3 Hot Reload Lifecycle

1. **Initialization**: CLI starts the transpiler, WebSocket server, and filesystem watcher.
2. **Detection and transpilation**: Watcher detects edits, parses GML, emits JavaScript, and creates a patch object.
3. **Patch delivery**: Server broadcasts the JSON payload; the runtime wrapper validates and installs the new JavaScript `Function` in the `__hot` registry.
4. **Execution**: `gml_call_script` is intercepted, checks the hot registry, and executes the new logic using existing instance state.

### 6.4 Integration Strategies

- **Bootstrap wrapper (recommended)**: Load the upstream runtime first, followed by a small `wrapper.js` that routes dispatchers through the hot registry.
- **Sidecar iframe**: Serve a development page hosting the GameMaker export in an `<iframe>`.
- **Service worker overlay**: Intercept requests for `index.html` and inject the wrapper code dynamically.

### 6.5 Technical Specifications

- **Hot-swappable components**: Scripts, object events, macros or enums, and shaders.
- **Closures**: Use a versioned closure-routing system so new closures capture the latest code.
- **Performance**: Typical total latency target is 120 to 180 ms.
- **Recovery**: Syntax errors broadcast an error notification while preserving existing logic.

### 6.6 Future Enhancements

- Semantic analysis for automatic dependency-aware rebuilds.
- Asset hot-reloading for sprites and sounds via stable resource-ID swapping.
- Source-map generation for in-game debugging of patched GML.
- In-game UI for patch rollback and version management.

## 7. UI Workspace Target State (`@gmloop/ui`)

### 7.1 Core UI Architecture

- `@gmloop/ui` is the sole owner of browser-facing UI rendering and interaction surfaces.
- UI implementation is Lit + TypeScript only; all UI components, state models, and events must be fully typed.
- UI behavior is organized as reusable, domain-specific Lit components rather than one-off string templates or ad-hoc DOM mutation.
- Graph rendering keeps D3 for layout/simulation where needed, but integrates through typed adapter boundaries that are framework-aware (`mount`, `update`, `dispose`).

### 7.2 Asset and Delivery Contract

- UI delivery is bundle-based, not single-inline-document based:
  - entry document (`index.html`)
  - bundled scripts and styles under `assets/`
  - deterministic renderer artifact metadata for CLI/server consumers.
- Production assets must be optimized by the build pipeline (bundled/minified/sourcemapped according to environment mode).
- CDN-hosted runtime dependencies are prohibited for shipped UI artifacts.
- Runtime JS/CSS dependencies (including visualization/runtime libraries) must be served from local bundle files only.

### 7.3 Styling Contract

- UI uses a single global stylesheet entrypoint for the application shell.
- Component and surface styling is authored in dedicated standalone `.css` files and composed through that global stylesheet entrypoint.
- Inline style strings and template-embedded standalone CSS blocks are not permitted for primary UI styling.
- Design tokens (colors, spacing, typography, elevation, motion timings) are centralized and reused across components.

### 7.4 Live / Hot Reload Workflow

- UI local development uses a dedicated dev server with hot module replacement (HMR) for fast feedback loops.
- CLI-hosted API endpoints (`/api/*`) are consumed through local proxying in dev mode so UI iteration does not require manual rebuild/restart loops.
- HMR is a development-only delivery path; production artifacts remain static bundle outputs consumed by CLI export/serve flows.

### 7.5 Type and Reuse Guarantees

- Public UI render contracts are typed and versioned by explicit TypeScript interfaces.
- Component inputs/outputs are typed (properties, custom events, callback contracts) with no untyped `any` escape hatches.
- Shared primitives (buttons/cards/badges/layout shells) are reused across surfaces to prevent duplication and drift.
- New UI surfaces must extend existing primitives/contracts before introducing new visual or state abstractions.
