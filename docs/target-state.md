# Target State

This document synthesizes the target, "north-star" state for this codebase; the GameMaker Language development toolkit "GMLoop". This target-state document covers its formatter/linter split, semantic analysis, project-wide codemod executions, bounded-memory streaming, transpilation, hot-reload infrastructure, and more.

## 1. Summary & Objectives

1. **Strict Separation of Concerns**: Split responsibilities into a Prettier-plugin formatter-only workspace (`/format`), an ESLint v9 language+rules workspace (`/lint`), a refactor/codemod workspace (`/refactor`), and shared core utilities (`/core`).
2. **Deterministic Formatting**: Keep the formatter deterministic and non-semantic. A Prettier plugin must not change formatting based on semantic meaning or program behavior. The formatter may render or reflow comments but must not interpret comment text to infer documentation structure or upgrade plain comments into documentation comments.
3. **Linter with Auto-Fixes**: Any non-layout, single-file-scoped rewrites should be handled by the linter's (`/lint`) rules with explicit diagnostics and optional `--write`. Lexical canonicalization (for example, operator aliases and numeric literal formatting) is permitted in the formatter, but syntactic or semantic rewriting is not. Any structural or semantic fixes must live in the `lint` workspace.
4. **Robust Semantic Analysis**: Implement a semantic layer that annotates the parse tree to power linting, refactoring, and transpilation, using the Sourcegraph Code Intelligence Protocol (SCIP) as the canonical symbol model.
5. **Bounded-Memory Refactors**: Run large-project semantic indexing and codemod pipelines without retaining monolithic project-wide aggregates in memory.
6. **Live Hot-Reloading**: Enable true hot-loading of GML code, assets/resources, and shaders without restarting the game by transpiling GML to JavaScript on demand and injecting it via a runtime wrapper. Live-reload sessions are one healthy watcher/status/runtime session per GameMaker project root by default. Stale registry records must be evicted when status probes fail. Live-reload UI status must be driven by automatic timer/focus polling of the status endpoint, not by a manual refresh button or parallel host refresh callback. Server-mode live-reload controls must remain visually stable: Stop is always present and disabled when no active session can be stopped. UI-triggered Live Reload startup must finish build/setup sequencing before opening the game runtime tab; successful startup responses must include a concrete runtime URL, and the UI must open that URL directly rather than pre-opening an `about:blank` placeholder. UI-triggered starts use start-or-reuse semantics so an existing healthy watcher/status/runtime session is adopted instead of starting a duplicate process that fails on occupied ports; CLI/MCP live-reload tool(s) follow the same attach-or-start default and requires an explicit force-new option for duplicate-session debugging. New UI-owned watcher children must receive per-session status and WebSocket ports instead of binding the fixed default ports. Vite/served-UI hot reloads must preserve the host-owned game Live Reload session by keeping the web bootstrap payload synchronized after start/stop, so remounting the UI cannot expose stale Start controls or orphan a running watcher process. Each UI tab has one top-level page toolbar containing the page title, subtitle, lifecycle badge, and main page controls.
7. **Official GameMaker Tool Complementarity**: Treat YoYoGames `gm-cli` and its ResourceTool MCP server as companion surfaces in autonomous GameMaker workflows. GMLoop should not proxy or mirror the official surface wholesale. It should provide GameMaker-specific semantic graph context, validation, lint/format/refactor workflows, hot reload, task evidence, and missing high-level automation that complements `gm-cli` with the idea that end-users can use both `gm-cli` and GMLoop together. Native GMLoop implementations are appropriate when GMLoop-specific semantic/refactor context, hot-reload behavior, deterministic fixture tests, or missing coverage in the official CLI requires them.

Concrete graph-index, retrieval, and visualization target-state details now live in [docs/gml-graph-index-plan.md](gml-graph-index-plan.md). Graph/search/context retrieval is owned by `@gmloop/semantic`; CLI, MCP, and UI layers present those semantic facts without duplicating graph truth.

## 2. Workspace Ownership Boundaries

### 2.1 General Ownership

- **Formatter (`/format`)**: Layout-only printing, indentation, wrapping, spacing, semicolon layout, print-width wrapping, and logical-operator style rendering. Must not synthesize or normalize semantic content. Lexical canonicalization is permitted, but syntactic and semantic rewriting is not. **The formatter never repairs invalid syntax and only formats valid AST.**
- **Linter (`/lint`)**: Local/single-file diagnostics and autofix rewrites. Semantic and content rewrites, synthetic function-doc tag generation, conversions of legacy/deprecated built-in functions, default placeholder comment cleanup. **Lint rule autofixes are responsible for fixing valid-but-forbidden syntax (e.g. style violations or deprecated patterns that are still syntactically valid).**
- **Refactor (`/refactor`)**: Codemod and migration transforms, explicit rename or refactor transactions, cross-file edits, metadata edits, impact analysis, safe identifier/resource renaming, and all other project-aware functionality. **Codemod/fixer commands are responsible for repairing non-parsable source text to restore parsability.**
- **Core (`/core`)**: Shared doc-comment helpers, AST metadata utilities, static GameMaker language metadata, normalization primitives; any and all cross-module/multi-module helpers that are/or should be shared across the various workspaces.
- **CLI (`/cli`)**: Provides the canonical command surface, path resolution, structured output, and GMLoop workflow coordination. It may integrate with `gm-cli` where a GMLoop workflow needs official tool output, but it should not become a wholesale proxy for `gm-cli` or duplicate ResourceTool's MCP surface.
- **CLI Watcher (`/cli`)**: Monitors the filesystem, coordinates the transpilation pipeline, emits telemetry, and manages the WebSocket server.
- **Transpiler (`/transpiler`)**: Parses GML via ANTLR4, converts GML AST to JavaScript, and generates patch objects.
- **Runtime Wrapper (`/runtime-wrapper`)**: Injected into the browser; maintains a hot registry of patched functions and overrides GML dispatchers.
- **MCP (`/mcp`)**: Exposes CLI-derived GMLoop tools and read-only resources for agents. It is a companion to, not a replacement for, `gm-cli`'s ResourceTool MCP server. It must not duplicate GMLoop CLI behavior, mirror `gm-cli`'s MCP catalog, own project metadata mutation already covered by ResourceTool, or implement browser automation primitives.
- **LSP (`/lsp`)**: Provides the GML Language Server Protocol surface for editors and LSP-to-MCP bridges. It owns protocol transport, document synchronization, range conversion, and session lifecycle, while delegating parser diagnostics, lint diagnostics/fixes, formatting, semantic symbol/navigation facts, and refactor edits to their owning workspaces. It must not duplicate GMLoop MCP tools or reimplement semantic/refactor/lint/format behavior.

### 2.1.1 Official Tool Complementarity Boundary

For GameMaker lifecycle operations, the design order is:

1. Check the current `gm-cli` command catalog and ResourceTool MCP catalog so GMLoop does not duplicate an official capability.
2. If the official MCP surface already serves the agent workflow directly, document that agents should use it alongside GMLoop.
3. Add a GMLoop CLI/MCP capability only when it contributes GMLoop-owned value: semantic graph context, validation evidence, lint/format/refactor orchestration, hot-reload integration, deterministic fixture behavior, or a missing high-level operation.
4. When a GMLoop workflow consumes `gm-cli` output internally, keep that integration narrow and typed; do not mirror the full official tool surface.

### 2.1.2 Identifier Reservation Boundary

Core may expose static GameMaker language facts, such as metadata-backed identifier inventories and context-specific checks for whether a name is unavailable in a language binding position. These APIs must stay syntax/language-level only: they may accept a generic binding context such as ordinary binding, argument binding, or enum member binding, and return whether the candidate identifier is reserved by GameMaker language rules.

Core must not own rename behavior, codemod categories, Feather diagnostics, symbol ids, scope lookup, project-aware collision analysis, retry/skip policy, or user-facing conflict messages. Those remain in the downstream owners:

1. **Semantic** owns identifier meaning: scopes, symbol resolution, project indexes, occurrence classification, and graph facts.
2. **Refactor** owns rename decisions: mapping codemod or rename target kinds to language binding contexts, detecting conflicts, planning edits, retrying candidate names, skipping unsafe changes, and reporting warnings/errors.
3. **Lint** owns only local diagnostics/fixes and must not import project-aware rename planning to answer reserved-name questions.

Boundary test: if an API needs an AST node, symbol id, scope id, project path, semantic provider, codemod category, Feather diagnostic, or rename request to answer correctly, it does not belong in Core. If it only classifies a candidate name against static GameMaker language metadata, Core is the correct owner.

### 2.2 Doc-Comment Ownership

- **Lint (`gml/normalize-doc-comment-tags`)** owns doc-comment marker/annotation and slash standardization/normalization, including `// @tag` to `/// @tag`, `// / Summary` to `/// Summary`, `//// @tag` to escaped `/// / @tag`, `@arg`/`@argument`/`@params` to `@param`, `@return` to `@returns`, and visibility/exception aliases such as `@private` to `@ignore`. It does not rewrite legacy function marker aliases.
- **Lint (`gml/normalize-doc-comments`)** owns function-doc block normalization, promotion of leading doc-comment text into description metadata, `@description` promotion and cleanup (including removal of empty `/// @description` or `/// @desc` at top-of-file or function doc blocks), and function-doc tag synthesis. When the rule rewrites a touched function-doc block, it consumes the same focused tag-alias canonicalization used by `gml/normalize-doc-comment-tags` so full-block fixes do not reintroduce stale aliases. Function docs should be normalized to `/// @desc`, whereas top-of-file description comments must use the full `/// @description`.
- **Lint (`gml/remove-doc-function-tags`)** owns removal of legacy `/// @function ...`, `/// @func ...`, `/// @funct ...`, and `/// @method ...` marker lines from documentation blocks.
- **Lint (`gml/normalize-doc-returns`)** owns conversion of legacy return description lines into canonical `@returns` metadata, such as rewriting `Returns: Boolean, indicating success` to `@returns {Boolean} Indicating success`.
- **Lint (`gml/normalize-doc-param-defaults`)** owns optional `@param` default cleanup when default text cannot be represented safely on one doc-comment line, such as collapsing synthesized multiline default expressions to default-free optional parameter docs.
- **Lint (`gml/normalize-doc-param-separators`)** owns `@param` description separator normalization (for example, `name - description` to `name description`).
- **Lint (`gml/normalize-doc-param-undefined-defaults`)** owns removal of explicit `undefined` defaults from optional `@param` doc names, such as rewriting `[value=undefined]` to `[value]`.
- **Lint (`gml/normalize-banner-comments`)** owns decorative banner normalization, including line-banner canonicalization, decorative block-banner collapse, non-doc-comment triple-slash normalization, and removal of decorative-only separators.
- **Format** owns rendering and spacing of already-existing or already-normalized doc comments and comment placement or layout that does not change text content. The formatter may decide comment placement or layout when that only affects whitespace, indentation, line breaking, or attachment. The formatter must not rewrite comment text, infer documentation semantics from raw comment text, or promote ordinary comments into documentation comments.
- **Core** owns shared doc-comment helpers used by lint and format.
- **Clarification**: Promotion of a plain comment into documentation form is a content-aware rewrite because it requires interpreting comment text to infer documentation structure. Such transformations must always live in lint rules, never in the formatter.

_Migration rule_: Do not add new doc-comment content mutation logic in formatter printers or transforms. Any new doc-comment synthesis, promotion, or tag or content rewrite must be implemented as lint rule or refactor behavior.

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

### 3.5 Lint Namespace And Fixer Ownership

1. Feather rules must be metadata-faithful. A `feather/gm####` rule may only diagnose and fix behavior covered by the matching official Feather diagnostic. It must not carry fixture-specific rewrites, formatting cleanup, or neighboring GM diagnostic behavior.
2. Exact or near-exact duplicate `gml/*` rules must be migrated into the owning Feather rule, preserving the safest implementation details, then removed completely from rule maps, presets, docs, examples, catalogs, and tests. Removed rule IDs must not be kept as aliases or compatibility shims.
3. Partial overlaps must use an explicit conflict registry. Both rules may continue reporting when useful, but the non-owner must expose no `meta.fixable`, must produce no suggestions, and must have fixes stripped centrally.
4. When a remaining `gml/*` rule conflicts with a Feather rule, the Feather rule should own the autofix, as long as it is safe, single-file scoped, and corresponds to the official Feather diagnostic. The overlapping `gml/*` rule must remain diagnostic-only for that exact overlap, while keeping fixes for behavior outside the Feather diagnostic.
5. Ownership cleanup must preserve all existing safe fixing behavior. If making a Feather rule metadata-pure would remove a safe local fix that does not belong to that Feather diagnostic, split that behavior into a smaller canonical rule instead of dropping it.
6. Before adding a new lint rule or fixer, consult the Feather metadata/catalog for an unimplemented `GM####` diagnostic that already owns the behavior or could own a safe local fixer. Prefer implementing the metadata-correct Feather ID before creating a new `gml/*` rule.
7. Feather manifest fixability must match runtime behavior and generated catalogs. Use explicit `none`, `safe-only`, or `always` metadata instead of blanket declarations.
8. Project-context-dependent Feather diagnostics are report-only in lint. If proving the fix requires project metadata, asset/resource graphs, or cross-file semantic knowledge, the write behavior belongs in refactor rather than a lint autofix.
9. Orphan local behavior with no corresponding Feather diagnostic may become a focused `gml/*` rule only when it is safe and single-file scoped. The z-write and z-test reset rules are examples: `gml/require-zwrite-enabled-reset` and `gml/require-ztest-enabled-reset`.
10. Fixture goldens may compose multiple canonical rules in `gmloop.json` to preserve output. Do not assign a fixer to the wrong Feather rule, exclude a fixture, or modify a `.gml` golden merely to hide an ownership mismatch. If no domain-correct composition can reproduce the golden, stop for clarification unless the user has explicitly authorized a report-only/unchanged expectation update.
11. Recommended, all, and Feather presets must stay deduplicated and use canonical owning IDs. When ownership migrates, presets and docs must move to the new IDs in the same change.

## 4. Semantic Analysis Target State

GMLoop must provide one authoritative, revision-aware semantic-analysis system that resolves and indexes the meaning of an entire GML project for every consumer, including the LSP, linter, refactor engine, codemods, transpiler, hot-reload system, CLI, project graph, documentation tools, and SCIP output. It must provide rapid interactive results through a two-tier model, thorough semantic understanding wherever statically possible, explicit and conservative handling of dynamic behavior, fast indexed lookup, safe project-wide transformations, output-sensitive incremental recomputation, immutable revision-consistent snapshots, validated persistent caching, bounded memory use, and deterministic behavior without prescribing a specific implementation language, storage engine, serializer, process model, or incremental-analysis framework.

### 4.1 Canonical Semantic Model

The semantic-analysis system must be the canonical source of semantic facts for a project revision, and all consumers must use those shared facts rather than independently inferring, approximating, or duplicating code meaning. The model must represent every declaration, scope, ownership form, type, resource, relationship, and reference form that can affect navigation, diagnostics, linting, refactoring, transpilation, hot reload, or project behavior, while keeping semantic meaning independent of consumer-specific presentation, lowering, execution, or storage decisions.

- The canonical model must cover projects, files, resources, syntax relevant to semantics, declarations, symbols, ownership, scopes, namespaces, signatures, definitions, occurrences, receivers, calls, reads, writes, construction, inheritance, overrides, implementations, documentation, diagnostics, semantic dependencies, compilation impact, hot-reload impact, refactor safety, resolution states, and completeness.
- Supported symbols and owners must include locals, parameters, functions, scripts, constructors, constructor-owned fields, structs, instance and object fields, implicit and explicit `self`, `other`, inherited members, statics, methods, globals, macros, enums, built-ins, reserved identifiers, resources, included files, extensions, packages, generated declarations, and other GameMaker-defined categories.
- The model must distinguish lexical, implicit-receiver, explicit-receiver, `self`, `other`, constructor, struct, static, inheritance, override, global, script, resource, macro, enum, built-in, extension, and dynamic lookup.
- The type model must distinguish declared, inferred, flow-narrowed, receiver, constructed, return, candidate, unknown, dynamic, invalid, and recovery types while supporting primitives, literals, objects, constructor instances, structs, functions, methods, resources, unions, recursive types, inference variables, built-ins, extensions, and project-defined types.
- Unknown, dynamic, candidate, ambiguous, unresolved, invalid, and exact results must remain semantically distinct, and cyclic inference or inheritance must terminate deterministically through a fixed-point or equivalent policy.
- Every occurrence must have an explicit resolution state equivalent to exact, candidate-set, dynamic, ambiguous, unresolved, or invalid, together with applicable candidates, lookup path, name domain, receiver information, provenance, completeness, uncertainty reason, and conservative assumptions.
- Dynamic and reflective behavior must be resolved as far as statically possible and otherwise indexed conservatively by relevant name domain, known or candidate name, ownership, operation, and resolution state so related uses can be found without treating all unresolved code as relevant.
- Symbol spelling must remain distinct from ownership and identity, with compact snapshot-local identities and deterministic cross-revision reconciliation sufficient for ordinary editing, cache reuse, movement, and explicit refactor mappings.
- Source and project errors, semantic-analysis limitations, and semantic-service or cache failures must remain distinguishable and must report their origin, affected capabilities, safety implications, and blocking behavior.
- Consumer-specific views may filter, aggregate, format, transform, or lower canonical facts, but must not redefine scope lookup, symbol identity, ownership, type meaning, inheritance, resource resolution, dependencies, or refactor safety
- All consumers/workspaces must access persistent semantic state through the same canonical semantic-service or cache interface, which owns schema, identity, fingerprinting, serialization, validation, concurrency, publication, migration, and recovery behavior

### 4.2 Revisions, Snapshots, Tiers, and Overlays

Every semantic result must belong to one explicit project revision, and every published snapshot must be immutable, internally consistent, and pinned for the duration of each request. The semantic system must use a two-tier availability model so interactive editor features can become useful quickly without waiting for complete project-wide relationship analysis, while operations that depend on global correctness can require a complete compatible snapshot.

* Revision inputs: source contents, overlays, document versions, project and resource metadata, included files and packages, extensions, configuration, runtime targets, built-ins, parser and semantic-engine compatibility, package versions, path rules, and project identity.
* Snapshot identity: project revision, analysis generation, tier, capabilities, coverage, overlay versions, validation state, and failed or excluded inputs.
* Progressive availability through separate immutable publications; published snapshots must not be mutated as additional analysis completes.
* Tier 1 optimized for rapid interactive use: project and resource metadata, built-ins, declarations, ownership, scopes, signatures, documentation, direct inheritance declarations, document and workspace symbols, completion candidates, active-file syntax and binding, on-demand file binding, hover, definition lookup, and semantic tokens.
* Tier 1 may analyze open, focused, recent, or explicitly requested files without building a complete project-wide occurrence or reverse-reference index.
* Lexical highlighting, built-ins, and other syntax-level features available independently of complete semantic indexing.
* Tier 2 optimized for complete project-wide relationships: all in-scope files analyzed, every relevant occurrence assigned an explicit resolution state, complete exact-reference and relevant non-exact indexes, inheritance and overrides, calls, type uses, resources, semantic dependencies, compilation and hot-reload impact, project-wide diagnostics, refactor safety, codemod prerequisites, and complete SCIP output.
* Tier 2 completeness defined by complete required coverage, current required indexes, explicit non-exact results, and no hidden failures or exclusions; universal exact resolution is not required.
* Find All References, project-wide rename, project-wide semantic codemods, complete SCIP generation, and other relationship-dependent operations must require a compatible Tier 2 snapshot.
* No silent fallback from required Tier 2 data to Tier 1, stale Tier 2, partial indexes, or incompatible document versions.
* When compatible Tier 2 data is unavailable, the operation must trigger or await compatible analysis, restart against a newer revision where necessary, respect cancellation, or fail explicitly.
* Every consumer must declare its required tier, capabilities, project and resource coverage, and overlay versions.
* Open, focused, and requested files prioritized during cold starts and ongoing indexing.
* Session-local unsaved overlays over validated disk state; saving, closing, or abandoning an overlay must transition or remove it without exposing mixed versions or affecting unrelated processes.
* No stale or superseded build published as current.
* Separate cancellation behavior for shared indexing work and individual requests.
* Explicit completion of failed, cancelled, superseded, or unpublishable work.
* Bounded snapshot and derived-cache retention, releasable request pins, reclaimable obsolete revisions, and reusable unchanged data.
* Clean shutdown with no owned workers, watchers, timers, publications, transactions, or pending semantic operations.

### 4.3 Relationships, Summaries, and Incremental Analysis

The semantic system must keep source relationships, project and resource relationships, type and dispatch relationships, compilation impact, hot-reload impact, and incremental query dependencies conceptually distinct. Derived semantic results must use a revision-aware dependency model so changes invalidate only consumers of changed facts, recomputation occurs at the narrowest practical semantic boundary, and propagation stops when externally relevant output remains unchanged.

- Supported relationships should include defines, declares, contains, owns, references, reads, writes, calls, constructs, uses type, inherits, overrides, implements, imports, includes, uses resource, generates, depends on configuration, depends on built-ins or extensions, affects compilation, affects hot reload, and depends on semantic results.
- A source reference must not automatically imply recompilation or hot-reload invalidation, and compilation or hot-reload dependencies need not correspond to direct source occurrences.
- Semantic summaries must distinguish implementation details from externally observable interfaces for functions, methods, constructors, objects, structs, events, resources, and project-global inputs.
- Summaries may include ownership, parameters, return and inferred types, declared and effective members, parents, overrides, reads, writes, global and resource effects, calls, constructed types, dynamic behavior, runtime-visible behavior, compilation interfaces, hot-reload compatibility, and exported documentation.
- Changes must be classified by semantic effect, including formatting, comments, documentation, local implementation, declarations, exported signatures, inferred types, effects, inheritance, effective members, overrides, resources, macros, preprocessing, runtime behavior, hot-reload compatibility, configuration, built-ins, extensions, and project structure.
- File-local results should be the primary persistence and replacement boundary, while declarations, bodies, methods, constructors, events, initializers, inference groups, inheritance groups, resources, and other mutually dependent units may be finer recomputation boundaries.
- A small edit must not make every semantic result in the containing file one indivisible dependency or cause unrelated source files to be parsed.
- Derived results must track the semantic inputs and other results they consume, their verified revision, required capabilities and coverage, and their semantic output or equivalent fingerprint.
- Invalidation should mark results for verification or recomputation rather than eagerly deleting or rebuilding all transitive dependents.
- Recomputed results whose externally relevant semantic output remains unchanged must stop further propagation at that boundary.
- Exact scoped work should be memoized and shared across consumers and tiers, while duplicate work must be observable and limited to valid causes such as cancellation, recovery, eviction, explicit rebuilding, or process isolation.
- Function implementation changes must not invalidate callers when consumed signatures and summaries remain unchanged, while signature, type, effect, resource, configuration, built-in, or extension changes must invalidate only consumers of changed facts when a reliable closure exists.
- Parent implementation changes must not rebuild descendant effective-member results when inherited meaning is unchanged, while parent interface changes must propagate through indexed direct relationships only through descendants whose effective outputs change.
- Full-project invalidation is permitted only when a change is genuinely project-wide or a narrower correct dependency closure cannot be proven because dependency information is missing, incompatible, incomplete, corrupt, or untrusted.
- Broad invalidation must be explicit, diagnosable, observable, and associated with a stated cause rather than silently reported as incremental work.

### 4.4 Persistent Storage, Validation, and Startup

The persistent semantic store must provide crash-safe, versioned, project-local storage for validated derived semantic state while remaining subordinate to authoritative source, project metadata, configuration, built-ins, extensions, included files, and active session overlays. Persisted data must be validated before use, readers must never observe partial generations, and compatible caches should provide rapid warm startup without compromising correctness.

- The store must account for schema, parser, semantic-engine, runtime, built-in, configuration, project, file, resource, content, and semantic fingerprints.
- Persistent publication must support complete atomic generations or equivalent guarantees, concurrent readers, coordinated writers, recovery from interrupted writers, removal of obsolete revisions, cache-size management, file and resource movement, project relocation, path normalization, and filesystem case differences.
- Readers must never observe incomplete, mixed, or partially written generations, and incompatible concurrent writers must not publish into one logical revision.
- Failure to acquire write coordination must permit safe read-only or non-persisting operation where appropriate rather than unsafe concurrent mutation.
- Unsaved editor overlays and private transformation revisions must remain outside shared disk-backed state by default.
- Persisted semantic data must be treated as untrusted until its schema, project identity, compatibility, fingerprints, integrity, completeness, bounds, offsets, counts, and paths are validated.
- Loading persisted data must not execute serialized behavior, instantiate arbitrary implementation-defined behavior, escape the permitted cache boundary, or override newer authoritative inputs.
- Corrupt, stale, incomplete, or incompatible data must be rejected, isolated, migrated, repaired, or deterministically rebuilt and must never become published semantic state.
- A compatible validated cache should provide zero-reanalysis warm startup for unchanged inputs, avoiding unnecessary parsing, full source scans, relationship reconstruction, and editor blocking.
- A true cold start may require complete parsing and semantic analysis but must preserve lexical highlighting, built-ins, active-file prioritization, progressive Tier 1 publication, and honest Tier 2 completeness reporting.
- Cache validation may use any deterministic evidence that reliably establishes compatibility and freshness without trusting stale metadata over newer source or project inputs.
- Dry runs must not mutate source files, project metadata, shared overlays, published snapshots, persistent storage, or cache metadata, although they may create isolated ephemeral analysis state.

### 4.5 Indexing, Interoperability, Performance, and Memory

The semantic architecture must provide purpose-built indexes for frequent navigation, analysis, transformation, and dependency operations and must scale through scoped work, compact identities, structural sharing, selective materialization, and bounded state rather than repeated full-project scans or larger heap limits. External projections such as SCIP must remain deterministic views of the richer internal model rather than constraining it.

- Indexed access must support symbols, qualified names, owner-local names, scopes and occurrences by position, definitions, exact references, candidate references, dynamic name uses, declared and effective members, direct parents and children, descendants, override families, callers, callees, type consumers, resource consumers, compilation dependents, hot-reload dependents, documentation, diagnostics, capabilities, and coverage.
- Lookup cost should be proportional to the relevant result set or affected dependency closure wherever practical.
- Complete descendant closures, flattened inherited-member sets, transitive dependency closures, and other large derived structures should be materialized only where their lookup or performance benefit justifies their memory cost.
- Documentation must support descriptions, parameters, return values, types, repeated or malformed tags, constructors, methods, fields, resources, built-ins, extensions, and included packages without malformed documentation corrupting semantic indexing.
- Hover, navigation, and semantic tokens must use one compatible snapshot, avoid unnecessary definition-file I/O when information is already indexed, represent uncertainty explicitly, and use ranges belonging to the requested document revision.
- SCIP or a compatible standard representation must be supported as a deterministic interoperable projection for navigation-oriented data, including project and document metadata, symbols, definitions, references, signatures, documentation, occurrence ranges, and supported relationships.
- SCIP must not constrain internal scopes, flow-sensitive types, receiver inference, dynamic states, incremental dependencies, invalidation, overlays, summaries, refactor simulations, compilation impact, hot-reload impact, capabilities, or coverage.
- The system must support compact semantic identities, bounded-memory processing, streamed or chunked persistence, replaceable scoped results, structural sharing, bounded overlays, bounded edit plans, bounded query caches, bounded snapshot retention, and selective relationship materialization.
- Monolithic full-project identifier accumulation, deep duplicated relationship structures, unbounded intermediate state, and increasing process heap limits as the primary scalability strategy must be avoided.
- Performance must be evaluated across representative project sizes, source volume, symbol and occurrence counts, resource counts, inheritance depth and fan-out, dynamic behavior, overlay counts, startup states, edit patterns, indexing workloads, reference queries, and project-wide transformations.
- Release criteria should measure Tier 1 availability, active-file reanalysis, hover, definition and reference latency, Tier 2 completion, warm startup, rename preflight, peak memory, persistent-cache size, files parsed, semantic units recomputed, propagation depth, reused results, duplicate work, and retained revisions.
- Performance optimizations must not weaken semantic correctness, snapshot consistency, determinism, explicit uncertainty, capability reporting, or transformation safety.

### 4.6 Rename, Refactors, and Codemods

Project-wide rename, binding-preserving refactors, and semantic codemods must be driven by compatible semantic facts rather than textual or structural heuristics. Every operation must declare its semantic requirements, preflight the complete affected safety closure, conservatively handle dynamic and non-exact occurrences, simulate proposed changes without mutation, apply edits through the strongest available transactional mechanism, and revalidate the resulting semantic state.

- Rename must determine the exact target, ownership, scope, rename family, exact definitions and references, relevant candidate and dynamic uses, inheritance and override relationships, dispatch, resources, generated names, project metadata, built-in restrictions, proposed-name collisions, and compatible project revision.
- Rename families may include locals, parameters, fields, constructor-owned fields, scripts, resources, inherited members, override families, and generated or project-linked declarations.
- A transformation safety closure must include every occurrence, scope, relationship, name domain, or derived result that could be affected by the old name, proposed name, visibility, capture, shadowing, dispatch, inheritance, overrides, resources, generated names, dynamic lookup, or changed semantic summaries.
- Unchanged dependency information may prove that occurrences outside the safety closure cannot be affected, avoiding unnecessary whole-project revalidation.
- Unrelated unresolved code must not block an operation when it can be proven unable to interact with the target, proposed name, relevant name domain, dispatch, or hierarchy.
- Relevant candidate, dynamic, ambiguous, unresolved, invalid, capturing, shadowing, dispatch-changing, inheritance-changing, resource-conflicting, or generated-name-conflicting cases must block the operation before mutation when safety cannot be proven.
- Built-in declarations, reserved identifiers, runtime-fixed names, syntactically invalid names, and target names that introduce semantic behavior changes must not be renamed or introduced.
- User-owned symbols that share built-in spelling must remain distinguishable from built-ins and may be renamed away when otherwise safe.
- Preflight must validate the selected target, rename family, all affected occurrences, lookup behavior under the proposed name, collisions, capture, shadowing, dispatch, inheritance, resource and generated-name conflicts, rename cycles, project revision, document versions, capabilities, and coverage.
- Preflight may construct a private semantic revision containing the proposed transformation, but it must not mutate source, metadata, shared overlays, published snapshots, or persistent storage.
- Application must verify that source and document versions still match preflight, apply the complete edit set through the strongest transactional mechanism available, and avoid intentionally publishing an intermediate mixed state.
- Environments without guaranteed atomic application must provide defined rollback, recovery, or explicit partial-failure handling.
- Post-transformation validation must confirm every intended post-change binding, preserve all unintended bindings within the safety closure, detect duplicate declarations, ambiguity, capture, shadowing, dispatch changes, inheritance changes, mixed naming, and unhandled dynamic references, and run required parsing, semantic, and configured compilation validation.
- Rename cycles must either be executed without invalid intermediate collisions or rejected before mutation.
- Codemods must declare their required tier, capabilities, coverage, uncertainty policy, atomicity, and validation requirements; preflight the complete operation; bound memory and overlay growth; report every correctness-relevant omission; produce deterministic plans; and reject unsafe partial application.
- Binding-preserving correctness requires updating all intended definitions and exact references while preserving unrelated bindings in the safety closure and passing declared validation, not proving general program equivalence.

### 4.7 Determinism, Observability, Testing, and Outcomes

Equivalent complete semantic inputs must produce equivalent externally observable results regardless of scheduling, processing order, worker assignment, or internal parallelism, and the system must expose enough structured information to explain its revisions, capabilities, cache behavior, incremental work, degraded fallbacks, transformation decisions, and resource use. Testing must verify semantic stability and target outcomes rather than incidental storage bytes, execution order, or implementation details.

- Determinism must apply to symbol identities within the documented model, type results, resolution states, diagnostics, relationships, summaries, change classifications, reference results, SCIP output, rename and codemod plans, semantic fingerprints, and persistent projections.
- Observability must include project revisions, snapshot identities, tiers, capabilities, coverage, overlay versions, cache validity, changed inputs, parsed files, recomputed units, invalidated symbols and results, reused work, semantic fingerprints, propagation boundaries, broad-invalidation causes, dynamic matches, blocking gaps, transformation safety closures, persistent-store mutations, evictions, retained snapshots, duplicate work, workers, watchers, pending operations, and shutdown state.
- Tests must verify that unrelated files are not parsed for ordinary edits, finer semantic units are reused, output-sensitive propagation stops at correct boundaries, stale or mixed revisions are never published, Tier 1 is never presented as complete Tier 2, capability requirements are enforced, dynamic uncertainty remains explicit, and unrelated unresolved code does not block safe transformations.
- Test coverage must include local edits, signature and inferred-type changes, parent implementation and interface changes, deep and cyclic inheritance, recursive inference, resources, macros, built-ins, extensions, dynamic strings, active overlays, repeated edits, warm and cold starts, cache incompatibility and corruption, interrupted writers, rename collisions and cycles, capture, shadowing, dispatch changes, partial Tier 2 failures, cancellation, superseded builds, dry runs, rollback behavior, bounded retention, and process shutdown.
- The target outcome is one DRY semantic foundation that provides rapid Tier 1 editor functionality, complete capability-qualified Tier 2 analysis, safe project-wide rename and codemods, zero-reanalysis compatible warm starts, fast indexed lookup, no unrelated parsing for ordinary edits, output-sensitive cascading, bounded memory and cache growth, crash-safe persistence, and deterministic results for every current and future consumer.
- The target state must remain independent of a specific programming language, database, serializer, graph engine, parser-incrementality strategy, process model, or incremental-query framework.
- Antipatterns include using SCIP as the complete internal model, equating references with compilation or hot-reload dependencies, silently guessing unresolved targets, treating Tier 2 as universal exact resolution, using probabilistic confidence instead of explicit resolution states, making files the only recomputation unit, maintaining one giant mutable graph, mutating published snapshots, persisting editor overlays as shared disk state, trusting cache data over source, requiring every process to share one literal in-memory object, reparsing the entire project for ordinary edits, blocking all transformations because of unrelated uncertainty, silently skipping correctness-relevant occurrences, revalidating the entire project when a complete safety closure is known, allowing unbounded snapshots or caches, relying primarily on increased heap limits, requiring byte-for-byte storage stability, requiring token-level incremental parsing without evidence, claiming proof of general program equivalence, publishing stale or mixed-revision results, or returning incomplete Tier 1 data as complete project-wide analysis

## 5. Transpiler & Hot Reload Pipeline

### 5.1 Core Concept & Role of the Transpiler

The hot-reload system bypasses the static nature of the GameMaker HTML5 runner by providing a side-channel for JavaScript patches generated from fresh GML source. The ANTLR4-to-JavaScript transpiler generates JavaScript for changed GML every time a watched file changes, reproducing the code-generation logic necessary for hot reloads.

### 5.2 System Architecture

- **GameMaker build tooling (external)**: Produces the HTML5 export through `gm-cli` or Igor. Agents may use those tools directly; GMLoop should add build commands only where it contributes hot-reload setup, evidence capture, log parsing, validation, or orchestration.
- **GameMaker project editing/manual lookup (external)**: ResourceTool and manual search stay owned by `gm-cli`. GMLoop should not maintain parallel CLI/MCP mirrors for those operations, but may add companion workflows that connect official results to semantic graph, diagnostics, refactors, or task evidence.
- **Dev server (Node.js/CLI)**: Watches GML files, transpiles them into JavaScript functions on demand, and broadcasts them as JSON patches via WebSocket.
- **Runtime wrapper (browser)**: Listens for patches via WebSocket and swaps function references in the GameMaker engine's internal registry.

### 5.3 Hot Reload Lifecycle

1. **Initialization**: CLI starts the transpiler, WebSocket server, and filesystem watcher.
2. **Detection and transpilation**: Watcher detects edits, parses GML, emits JavaScript, and creates a patch object.
3. **Patch delivery**: Server broadcasts the JSON payload; the runtime wrapper validates and installs the new JavaScript `Function` in the `__hot` registry.
4. **Execution**: `gml_call_script` is intercepted, checks the hot registry, and executes the new logic using existing instance state.

### 5.4 Integration Strategies

- **Bootstrap wrapper (recommended)**: Load the upstream runtime first, followed by a small `wrapper.js` that routes dispatchers through the hot registry.
- **Sidecar iframe**: Serve a development page hosting the GameMaker export in an `<iframe>`.
- **Service worker overlay**: Intercept requests for `index.html` and inject the wrapper code dynamically.

### 5.5 Technical Specifications

- **Hot-swappable components**: Scripts, object events, macros or enums, and shaders.
- **Closures**: Use a versioned closure-routing system so new closures capture the latest code.
- **Performance**: Typical total latency target is 120 to 180 ms.
- **Recovery**: Syntax errors broadcast an error notification while preserving existing logic.

### 5.6 Future Enhancements

- Asset hot-reloading for sprites and sounds via stable resource-ID swapping.
- Source-map generation for in-game debugging of patched GML.
- In-game UI for patch rollback and version management.

## 6. UI Workspace Target State (`@gmloop/ui`)

### 6.1 Core UI Architecture

- `@gmloop/ui` is the sole owner of browser-facing UI rendering and interaction surfaces.
- UI implementation is Lit + TypeScript only; all UI components, state models, and events must be fully typed.
- UI behavior is organized as reusable, domain-specific Lit components rather than one-off string templates or ad-hoc DOM mutation.
- Graph rendering keeps D3 for layout/simulation where needed, but integrates through typed adapter boundaries that are framework-aware (`mount`, `update`, `dispose`).

### 6.2 Asset and Delivery Contract

- UI delivery is bundle-based, not single-inline-document based:
    - entry document (`index.html`)
    - bundled scripts and styles under `assets/`
    - deterministic renderer artifact metadata for CLI/server consumers.
- Production assets must be optimized by the build pipeline (bundled/minified/sourcemapped according to environment mode).
- CDN-hosted runtime dependencies are prohibited for shipped UI artifacts.
- Runtime JS/CSS dependencies (including visualization/runtime libraries) must be served from local bundle files only.

### 6.3 Styling Contract

- UI uses a single global stylesheet entrypoint for the application shell.
- Component and surface styling is authored in dedicated standalone `.css` files and composed through that global stylesheet entrypoint.
- Inline style strings and template-embedded standalone CSS blocks are not permitted for primary UI styling.
- **All visual styling values** must be defined as global CSS custom properties (CSS variables) in the shared design-token stylesheet and consumed exclusively through those variables across all component and surface stylesheets. This applies to every category of styling value: colors, font-weights, text-sizes (font-size), line-heights, spacing (margins, paddings, gaps, layout offsets), border-radii, shadows, transitions, component heights, icon sizes, and font families. Do not use hardcoded literal values (pixel values, hex colors, rgb/rgba values, raw font-weight numbers, raw font-size values, etc.) in component or page CSS files. If a needed token does not exist in the shared stylesheet, add it there first, then reference the new variable. This keeps the visual system DRY, globally consistent, and easy to adjust.

### 6.4 Live / Hot Reload Workflow

- UI local development uses a dedicated dev server with hot module replacement (HMR) for fast feedback loops.
- CLI-hosted API endpoints (`/api/*`) are consumed through local proxying in dev mode so UI iteration does not require manual rebuild/restart loops.
- HMR is a development-only delivery path; production artifacts remain static bundle outputs consumed by CLI export/serve flows.

### 6.5 Type and Reuse Guarantees

- Public UI render contracts are typed and versioned by explicit TypeScript interfaces.
- Component inputs/outputs are typed (properties, custom events, callback contracts) with no untyped `any` escape hatches.
- Shared primitives (buttons/cards/badges/layout shells) are reused across surfaces to prevent duplication and drift.
- Every button that launches an asynchronous UI-host process uses the shared process-button pending presentation. It retains its normal label, adds the shared loading circle, sets `aria-busy="true"`, becomes natively disabled with the standard disabled cursor, and blocks duplicate or conflicting operations until the process settles. Page-specific spinner markup and replacement pending labels are not permitted.
- New UI surfaces must extend existing primitives/contracts before introducing new visual or state abstractions.

### 6.6 Auto-Game Agent Skills

- Auto-Game skills use the open Agent Skills specification: one conventional `skills/<name>/` directory per skill, with YAML frontmatter and Markdown instructions in `SKILL.md` plus optional standard `scripts/`, `references/`, and `assets/` content. GMLoop does not define a custom bundle or skill format.
- Auto-Game development resources live in the standalone `src/agent-pack/` workspace, published as the `@gmloop/agent-pack` npm package. The package is independently installable in a game repository with `npm install -D @gmloop/agent-pack`; consumers can inspect, copy, or point standards-compatible tooling at the raw GMLoop-provided skills without installing the rest of GMLoop.
- The agent-pack's conventional `skills/` directory is the single source of truth for packaged Auto-Game skills. Every GMLoop-provided skill directory and its `SKILL.md` frontmatter name starts with the reserved `gmloop-` prefix. Adding or removing a standard `gmloop-<name>/SKILL.md` directory changes the published package and what initialization offers without editing a manifest, name list, loader, validator, or skill-specific code; initialization rejects packaged directories that violate the prefix requirement.
- The packaged GMLoop tooling skill remains discovery-first: it explains GMLoop's capability categories, stable help entrypoint, project configuration ownership, and parse/recovery/refactor/lint/format workflow without embedding a volatile inventory of MCP tool names or schemas. Engine compilation, unit tests, HTML5 launch, and browser/play verification remain in the autonomous project lifecycle, which may prefer configured gm-cli and Playwright MCP capabilities without requiring them.
- Documentation, tests, and UI code must not duplicate the collection inventory or size. The filesystem collection is the inventory, and each `SKILL.md` is the authoritative description of that skill.
- The npm package distributes ordinary Agent Skills directories and portable project guidance from `templates/project-agents.md`, not a custom skill archive, registry, provider overlay, or runtime bundle. The installed project-root `AGENTS.md` defines a vendor-neutral autonomous iteration lifecycle: orient to the existing game, choose the smallest player-visible outcome, implement a bounded slice, validate and play it, respond to evidence, and leave a clear next iteration. It has no standalone executable and performs no install-time project mutation; explicit GMLoop CLI or UI initialization materializes copies at standard project locations when desired.
- `@gmloop/cli` consumes `@gmloop/agent-pack`; it does not own or duplicate the pack's resources. `gmloop agent-pack init --path <game-project>` is the sole command-line initializer and materializes the applicable pack resources into the project, including skills under `<game-project>/.agents/skills` and project guidance at `<game-project>/AGENTS.md` where needed. It creates or merges the project-root `.gitignore` by default with `.gmloop/`, `.gmcache/`, `node_modules/`, `.playwright-mcp/`, `cache/`, and `.agents/skills/**/gmloop-*`; `--no-gitignore` disables only that optional hygiene step.
- Agent MCP integration setup is provider-CLI-owned. Auto-Game may detect Codex, Gemini/Antigravity, and Qwen config state for display, and may run verified project-scoped provider CLI commands such as `qwen mcp add --scope project`, but it must not directly edit third-party agent config files. Unsupported targets remain visible with manual setup guidance.
- Initialization records only the installed agent-pack version and file provenance required for repeatable, conflict-safe updates. It creates missing resources and may refresh files that are unchanged from the previously installed pack, but it never silently overwrites project-authored or project-modified content. Skipped conflicts are reported deterministically.
- When the loaded project has no initialized agent pack or has an older installed version, the Auto-Game UI presents an **Initialize Auto-Game Agent Pack** or **Update Auto-Game Agent Pack** button as appropriate. Project skills without an installation receipt are reported as **Setup Incomplete**, not initialized or current, because their package version and provenance are unknown; the UI offers **Complete Auto-Game Setup** for that state. A default-checked option lets the user include or omit the same conflict-safe `.gitignore` merge available from the CLI. While initialization or update is pending, the action uses the shared disabled/busy/loading-circle presentation and related initialization options and skill mutations remain disabled. A successful action installs or updates the same standalone package resources and refreshes the displayed skill state; failures and preserved conflicts remain visible and actionable.
- Auto-Game discovery is rooted exclusively at the loaded GameMaker project containing the active `.yyp`. It never falls back to the GMLoop repository or process working directory.
- The Auto-Game UI lists every discovered project skill with its name, description, source path, file-availability status, and an enable/disable toggle. Every skill can be toggled. The skill list uses a keyboard-native disclosure and is closed by default to keep the operations surface compact.
- The Auto-Game UI provides read-only, keyboard-accessible previews of the packaged `AGENTS.md`, `.gitignore`, and all packaged skill resources before initialization. Preview content comes from `@gmloop/agent-pack`, never from project-owned files, and does not imply that a resource is installed or active.
- Every skill discovered in the loaded project is included in Auto-Game by default. `gmloop.json` persists only excluded-name exceptions under `autoGame.disabledSkills`; there is no second activation, installation, trust, approval, or permission layer. Project skill discovery is independent of the agent-pack receipt, so the UI distinguishes detected/included project skills from whether GMLoop's agent pack is initialized or current.
- The active AI tool or CLI reads enabled project skills through its existing Agent Skills discovery and retains sole ownership of activation, permissions, trust, and execution behavior. GMLoop does not interpret or execute skill instructions.
- GMLoop uses the established `gray-matter` package _only_ to read display metadata. It does not implement an Agent Skills grammar, schema, parser, or conformance validator. The shipped collection and any explicit validation workflow use the official `skills-ref` reference tool (or another established standards-compatible validator).
- Auto-Game skills are vendor- and client-neutral. They must not require a specific LLM vendor, agent product, MCP server, command name, or provider-specific metadata to be useful.
- Skills are self-contained and independently triggerable. They should describe required capabilities and outcomes instead of referring to other skills or assuming another skill has already run. Tool-specific examples belong only where the workflow cannot be expressed portably.
- The GMLoop source repository's `.agents/skills` directory is exclusively for LLMs and agents developing GMLoop itself. It is never an Auto-Game skill source and is never read or modified by Auto-Game initialization or discovery.

## 7. Agent Coordination Boundary

GMLoop is a first-class GameMaker companion surface for AI agents, not a
general multi-agent coordinator.

GMLoop owns the GameMaker-specific tooling layer: project understanding,
semantic graph context, parser/lint/refactor/format/fix workflows, live-reload
status, MCP tool exposure, agent-pack installation, skill discovery, and
project guidance. External agent managers own orchestration: model selection,
agent scheduling, permissions, approvals, retries, memory, budgets, queues,
task routing, and long-running workflow state.

```text
External agent coordinator
  Codex / Claude Code / Qwen / OpenHands / AutoGen / CrewAI / LangGraph / etc.
        |
        | MCP + project files + skills + guidance
        v
GMLoop
  parser / semantic graph / lint / refactor / format / fix / live reload / UI / MCP
        |
        v
GameMaker project
```

The GMLoop UI may include an Auto-Game or Agents companion dashboard that
exposes installed skills, skill enablement, packaged guidance previews,
MCP/tool readiness, graph/search context, validation results, fix/refactor
actions, live-reload status, and task evidence. It may provide lightweight
affordances such as copying prompts, opening an external agent, or launching a
configured companion command.

The UI must not become a multi-agent DAG editor, model router, prompt debugger
for arbitrary frameworks, workflow engine, approval/permission system, memory
store, or background task queue. GMLoop integrations with agent frameworks are
optional adapters over stable local contracts, not core dependencies. The core
product remains vendor-neutral and coordinator-neutral: GMLoop makes agents
better at working on GameMaker projects without inheriting the complexity,
security risk, and product scope of a full agent platform.
