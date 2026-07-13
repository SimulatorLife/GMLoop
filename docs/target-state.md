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

## 4. Semantic Analysis, Symbol Indexing, and Storage

### 4.1 Purpose

ANTLR4 provides the syntactic structure of GML source code but does not determine its meaning. GMLoop must provide a semantic-analysis layer that resolves and records the meaning of project declarations, identifiers, expressions, resources, relationships, and dependencies.

The semantic-analysis system is the authoritative source of semantic facts for a specific project revision. Downstream systems, including the LSP, linter, refactor engine, codemods, transpiler, hot-reload system, project graph, and CLI tools, must consume these shared semantic facts rather than independently inferring or approximating code meaning.

The semantic system must support:

- Symbol declaration and identity.
- Lexical, instance, object, constructor, struct, static, global, built-in, and resource scopes.
- Identifier and member resolution.
- Type representation and inference.
- Function and method dispatch.
- Inheritance and override relationships.
- Definition and reference indexing.
- Resource and project relationships.
- Dependency and impact analysis.
- Documentation and signature extraction.
- Refactor-safety validation.
- Incremental invalidation and recomputation.
- Deterministic transpilation decisions.
- Semantic diagnostics and explicit semantic-gap reporting.

### 4.2 Canonical Semantic Model

The semantic-analysis service is the canonical source of semantic facts for a project revision.

The canonical semantic model must represent, directly or through deterministic queries:

- Files and project resources.
- Syntax and semantic nodes.
- Declarations.
- Symbols.
- Symbol ownership.
- Symbol kinds.
- Scopes and scope relationships.
- Namespaces.
- Types.
- Function and method signatures.
- Definitions and occurrences.
- Identifier and property resolution.
- Receiver resolution.
- Inheritance.
- Overrides and implementations.
- Calls.
- Reads and writes.
- Resource references.
- Documentation.
- Diagnostics.
- Semantic dependencies.
- Compilation and hot-reload impact.
- Refactor-safety information.
- Resolution confidence and semantic gaps.

The canonical semantic model must not be limited to the information expressible in an external navigation or interchange format.

The project must not be represented as one giant mutable graph. The design must support immutable or revisioned semantic snapshots, replaceable file-local semantic results, indexed relationships, and scoped derived queries.

### 4.3 Semantic Facts and Transpilation Decisions

Semantic analysis and JavaScript emission are separate responsibilities.

The semantic layer must determine facts such as:

- The resolved target symbol.
- The symbol kind.
- The declaring scope.
- The owning object, constructor, struct, resource, or namespace.
- The receiver kind.
- The resolved receiver type, where known.
- The lookup path used to resolve the occurrence.
- Whether access is explicit or implicit.
- Whether the occurrence reads, writes, calls, constructs, or references the symbol.
- The dispatch kind.
- The resolution confidence.
- Relevant built-in, reserved-name, and shadowing rules.

The transpiler consumes these facts and determines the appropriate JavaScript representation.

Typical lowering decisions may include:

1. Local variables or parameters emitted as JavaScript-local identifiers.
2. Instance fields emitted through `self.<name>`.
3. `other` fields emitted through `other.<name>`.
4. Global fields emitted through the configured global-state representation.
5. Built-in functions, variables, and constants emitted through their configured shims.
6. Script calls emitted directly or through a hot registry, wrapper, or thunk according to the active runtime mode.
7. Resource references emitted through their configured runtime representation.

These lowering forms are not themselves the canonical semantic classification.

The semantic model must remain valid independently of a specific output language, transpilation strategy, runtime wrapper, or hot-reload implementation.

### 4.4 Supported Symbol and Scope Model

The semantic system must support every valid GML declaration, scope, ownership form, and reference form that can affect analysis, navigation, refactoring, linting, transpilation, or hot reload.

This includes, without limiting the implementation to a fixed enumeration:

- Local variables.
- Function parameters.
- Function-local declarations.
- Script functions.
- Constructors.
- Constructor-owned fields.
- Struct fields.
- Instance fields.
- Implicit and explicit `self` fields.
- `other` fields.
- Object-owned fields.
- Inherited fields and methods.
- Static variables and static members.
- Methods.
- Global variables.
- Macros.
- Enums and enum members.
- Built-in functions.
- Built-in variables.
- Built-in constants.
- Reserved identifiers.
- Object resources.
- Sprite resources.
- Room resources.
- Sequence resources.
- Shader resources.
- Timeline resources.
- Audio resources.
- Fonts.
- Paths.
- Included files.
- Extension-provided symbols.
- Other GameMaker resources and project-defined symbol categories.

The model must correctly represent constructor-owned declarations such as:

```gml
self.timer = new TimerMultiplier();
````

and member accesses such as:

```gml
timer.get_multiplier();
self.timer.set_multiplier(value);
```

The model must distinguish lexical lookup, implicit receiver lookup, explicit receiver lookup, inheritance lookup, global lookup, resource lookup, built-in lookup, and dynamic lookup.

### 4.5 Identifier and Member Resolution

Identifier and member resolution must be deterministic whenever the source and project state provide enough information to determine a result.

Resolution must account for:

* Lexical scope.
* Scope nesting.
* Declaration order where semantically relevant.
* Function parameters and locals.
* Object and event context.
* Implicit `self`.
* Explicit `self`.
* `other`.
* Constructor context.
* Struct context.
* Static context.
* Receiver type.
* Inheritance.
* Overrides.
* Globals.
* Scripts.
* Resources.
* Macros.
* Enums.
* Built-ins.
* Reserved identifiers.
* Project configuration.
* GameMaker runtime and built-in definitions.
* Extensions and included packages.
* Invalid or incomplete source.

Each occurrence must have an explicit resolution state.

Supported resolution states must include the equivalent of:

* `exact`: The occurrence resolves to exactly one known semantic target.
* `candidate-set`: The occurrence resolves to a bounded set of possible targets.
* `dynamic`: The target depends on runtime data and cannot be determined statically.
* `ambiguous`: Multiple targets remain possible because of incomplete or conflicting semantic information.
* `unresolved`: No valid target could be determined.
* `invalid`: The occurrence is part of syntactically or semantically invalid code.

The system must never silently treat a candidate, dynamic, ambiguous, unresolved, or invalid occurrence as exact.

### 4.6 Dynamic GML Behavior

GML permits runtime name-based access and other dynamic behaviors that cannot always be resolved statically.

Examples include:

* Instance-variable access by runtime string.
* Struct-field access by runtime string.
* Resource lookup by runtime string.
* Reflection-like helper functions.
* Extension APIs with unknown semantic behavior.
* Values whose receiver type cannot be statically bounded.

The semantic system must resolve all statically determinable references and conservatively represent all remaining uncertainty.

Dynamic behavior must be handled through one or more of:

* Constant-string analysis.
* Candidate-set analysis.
* User-provided contracts or annotations.
* Extension metadata.
* Conservative dependency edges.
* Explicit diagnostics.
* Refactor blocking when safety cannot be proven.

The long-term goal is to continually reduce unsupported or unnecessarily unresolved cases. It is not a requirement to claim exact static knowledge where the language permits genuinely dynamic behavior.

### 4.7 Semantic Gaps and Diagnostics

Any non-exact semantic result that affects a supported operation must be explicitly represented and diagnosable.

Semantic-gap categories should include the equivalent of:

* Parse recovery.
* Unsupported syntax.
* Missing project resource.
* Missing included file.
* Missing extension metadata.
* Unknown built-in or runtime version.
* Ambiguous lexical resolution.
* Ambiguous receiver.
* Dynamic string lookup.
* Incomplete type information.
* Invalid inheritance.
* Inheritance cycle.
* Cyclic inference.
* Unknown external behavior.
* Stale dependency information.
* Cache incompatibility.
* Internal semantic invariant failure.

Each semantic gap must be able to report:

* Its category.
* Its source file and range.
* Its severity.
* Its diagnostic message.
* Its candidate symbols, where known.
* Whether the result is conservative.
* Which operations are affected.
* Whether navigation remains safe.
* Whether transpilation remains safe.
* Whether hot reload remains safe.
* Whether rename or another refactor must be blocked.

Semantic gaps must not be silently ignored.

### 4.8 Symbol Identity

The semantic system must distinguish fast snapshot-local identity from cross-revision identity.

A symbol may have:

* A compact snapshot-local identity optimized for indexing and lookup.
* A stable or reconciled cross-revision identity used to associate declarations across ordinary edits.
* A current qualified semantic name.
* An external SCIP symbol representation where applicable.

A symbol's name must not be its only internal identity.

Renaming a declaration must not inherently cause the semantic system to treat it as an unrelated declaration during the refactor transaction.

Cross-revision identity is not required to survive arbitrary unrelated source movement forever. It must be stable enough to support ordinary editing, incremental analysis, cache reuse, and explicit refactor mappings.

### 4.9 SCIP Projection

GMLoop must support the Sourcegraph Code Intelligence Protocol, or a compatible standardized code-intelligence representation, as the canonical interoperable projection for navigation-oriented semantic data.

The SCIP projection may contain:

* Symbol definitions.
* Symbol references.
* Symbol documentation.
* Symbol signatures.
* Definition ranges.
* Occurrence ranges.
* Supported symbol relationships.
* Project and document metadata.

SCIP is not the sole canonical semantic model and must not constrain the internal representation of:

* Scopes.
* Flow-sensitive types.
* Receiver inference.
* Query dependencies.
* Incremental invalidation.
* Refactor simulations.
* Compilation-impact relationships.
* Dynamic-resolution states.
* Project overlays.
* Internal semantic summaries.

SCIP symbols must be deterministic for a given project revision.

SCIP symbol naming must follow the selected SCIP symbol grammar and must distinguish:

* Project or package identity.
* Symbol ownership.
* Symbol kind.
* Qualified descriptors.
* Document-local symbols where appropriate.

A deterministic GML-oriented naming scheme may conceptually represent symbols such as scripts, objects, methods, constructors, fields, and resources, but the exact external encoding is an implementation decision.

SCIP generation must be deterministic and reproducible from the canonical semantic snapshot.

### 4.10 Relationship and Dependency Categories

Definition and reference relationships must not be treated as equivalent to compilation or invalidation dependencies.

The semantic system must distinguish relationship categories such as:

* Defines.
* Declares.
* Contains.
* References.
* Reads.
* Writes.
* Calls.
* Constructs.
* Uses type.
* Inherits from.
* Is inherited by.
* Overrides.
* Is overridden by.
* Implements.
* Imports or includes.
* Uses resource.
* Generates or owns.
* Depends on configuration.
* Depends on built-in definitions.
* Affects compilation.
* Affects hot reload.
* Depends on semantic query results.

The system must maintain conceptually separate models for:

1. Source-level semantic relationships.
2. Project and resource relationships.
3. Compilation and hot-reload impact.
4. Incremental semantic-query dependencies.

A source reference does not automatically require dependent recompilation.

A compilation dependency does not always correspond to a direct source occurrence.

### 4.11 Semantic Summaries and Change Classification

The semantic system must distinguish internal implementation changes from externally observable semantic-interface changes.

Dependents must be invalidated according to the semantic facts they consume, not merely because the defining file changed.

The system should support semantic summaries or equivalent derived facts for declarations such as functions, methods, constructors, objects, structs, and resources.

Relevant summary information may include:

* Declared name and ownership.
* Parameters.
* Return type.
* Declared or inferred type.
* Declared members.
* Effective inherited members.
* Base types or parent objects.
* Override relationships.
* Read effects.
* Write effects.
* Global effects.
* Resource effects.
* Called symbols.
* Constructed types.
* Dynamic-behavior flags.
* Hot-reload compatibility.
* Exported documentation.

Changes should be classifiable into categories such as:

* Formatting-only.
* Documentation-only.
* Local implementation.
* Local declaration.
* Declaration-set change.
* Exported signature change.
* Inferred-type change.
* Inheritance change.
* Resource-identity change.
* Macro or preprocessing change.
* Runtime-effect change.
* Configuration change.
* Built-in-definition change.

A local implementation change must not automatically invalidate all callers when the semantic facts consumed by those callers remain unchanged.

### 4.12 Immutable and Revisioned Semantic Snapshots

Every published semantic result must belong to a specific project revision.

A project revision must account for all semantic inputs, including:

* Source files.
* Active editor overlays.
* Document versions.
* Project metadata.
* Resource metadata.
* Included files.
* Extensions.
* Configuration.
* Runtime target.
* GameMaker built-in definitions.
* Parser version.
* Semantic-engine version.
* Relevant package versions.

Each published semantic snapshot must be immutable from the perspective of consumers.

A request must observe one consistent semantic revision.

A request must not observe a mixture of:

* Tier 1 data from one revision.
* Tier 2 data from another revision.
* Saved files from one revision.
* Unsaved editor overlays from another revision.

Publishing a new semantic snapshot must be atomic.

A stable semantic-service or navigation-service object may retain its identity, but its current snapshot must be replaced through an atomic publication mechanism rather than mutating a published snapshot in place.

Requests already using an older valid snapshot may complete against that snapshot unless the operation explicitly requires the newest revision.

Stale results must never be published as results for newer document versions.

### 4.13 File-Local Semantic Results

Semantic processing should support replaceable file-local analysis units.

A file-local semantic result may contain:

* Parsed syntax.
* Lowered semantic or intermediate nodes.
* Declarations.
* Local scopes.
* Occurrences.
* Outgoing references.
* Outgoing calls.
* Outgoing resource relationships.
* Outgoing type relationships.
* Documentation.
* Diagnostics.
* Semantic summaries.
* Dependency inputs.
* Content and semantic fingerprints.

When a file changes, its previous file-local semantic result may be replaced atomically rather than mutating individual records throughout a global graph.

Global reverse indexes and derived relationships must be updated consistently when a file-local result is replaced.

The exact storage layout, serialization format, and in-memory representation remain implementation decisions.

### 4.14 Two-Tier Semantic Indexing

GMLoop must support progressive semantic availability so interactive editor features are not unnecessarily blocked by complete project-wide relationship indexing.

#### 4.14.1 Tier 1: Declarations and Interactive Binding

Tier 1 must prioritize rapid availability of the semantic facts required for basic editor interaction.

Tier 1 should provide or restore:

* Project and resource metadata.
* Built-in definitions.
* Declarations.
* Symbol ownership.
* Scope summaries.
* Exported signatures.
* Direct inheritance declarations.
* Documentation.
* Document and workspace symbols.
* Basic completion candidates.
* Active-file syntax.
* Active-file or on-demand semantic binding.
* Basic hover.
* Basic Go to Definition.
* Lexical and semantic-token support where applicable.

Tier 1 is not required to build the complete project-wide reverse-reference index.

Tier 1 may bind occurrences in open, focused, or requested files without recording all references across every project file.

Open and focused files must be prioritized.

Lexical syntax highlighting and built-in token support must remain available independently of a complete semantic cache.

#### 4.14.2 Tier 2: Complete Project Relationships

Tier 2 must provide the complete semantic information required for project-wide operations.

Tier 2 should include:

* Resolved occurrences across the project.
* Reverse-reference indexes.
* Complete inheritance relationships.
* Override and implementation relationships.
* Call relationships.
* Type-use relationships.
* Resource relationships.
* Dependency and impact indexes.
* Project-wide diagnostics.
* Refactor-safety information.
* Project-wide codemod prerequisites.
* Complete SCIP output.
* Hot-reload impact information.

Reference-dependent operations such as Find All References, project-wide rename, and semantic codemods must require a compatible Tier 2 snapshot.

They must never silently fall back to incomplete Tier 1 data.

If Tier 2 is unavailable, stale, failed, or incompatible with the requested document versions, the operation must:

* Wait for or trigger a compatible build.
* Restart against a newer compatible revision where required.
* Fail explicitly with diagnostics.
* Respect request cancellation.

It must not return a partial project-wide result as though it were complete.

### 4.15 Build Revisioning, Cancellation, and Publication

Every semantic build must be associated with a project revision.

If source, project, configuration, or overlay inputs change during a build:

* The running build becomes associated only with its original revision.
* A stale build must not be published as the current revision.
* Superseded work should be cancelled where practical.
* Reusable file-local or query results may be retained if their inputs remain valid.
* A new compatible build must be scheduled for the newer revision.

Shared project builds and individual LSP requests must have distinct cancellation semantics.

Cancelling one request must not necessarily cancel shared indexing work needed by other consumers.

Build failures must complete all affected waiters with an explicit error or diagnostic.

No request may wait indefinitely on a build that has failed, been superseded, or can no longer be published.

Shutdown must cancel or join all owned semantic work and leave no worker, timer, watcher, store transaction, publication, or pending promise alive.

### 4.16 Unified Semantic Service and Persistent Cache Boundary

All GMLoop consumers must use the same semantic-service contract and compatible persistent-cache representation.

Consumers include:

* VS Code through the LSP.
* Semantic tokens.
* Hover.
* Completion.
* Navigation.
* CLI semantic commands.
* Lint rules requiring semantic facts.
* Refactors.
* Codemods.
* Transpilation.
* Hot reload.
* Project-graph visualization.
* SCIP generation.

The persistent cache may be stored under the target project's `.gmloop/` directory or another explicitly defined project-local cache location.

The persisted cache is a derived artifact. It is not the ultimate source of truth.

The authoritative semantic inputs are:

* Source files.
* Project files.
* Resource metadata.
* Configuration.
* Built-in definitions.
* Extensions.
* Included files.
* Active editor overlays for the relevant session.

For a validated project revision, the published semantic snapshot is the authoritative source of semantic facts for consumers operating on that revision.

Separate processes may maintain separate immutable in-memory snapshots and query caches. They must share:

* A compatible semantic model.
* A compatible persistent schema.
* Revision and fingerprint rules.
* Serialization behavior.
* Cache-validation behavior.
* Concurrency rules.
* Publication guarantees.

The requirement is not that all processes share one literal mutable in-memory object.

### 4.17 Active Editor Overlays

Unsaved editor buffers must be represented as session-local overlays by default.

The editor-visible semantic revision consists conceptually of:

```text
validated persisted or disk-backed project state
+ active session overlays
= editor-visible semantic snapshot
```

Unsaved overlays must not automatically replace or mutate the persisted disk-based semantic state consumed by unrelated CLI processes.

Requirements include:

* Each overlay is associated with a document URI and version.
* Editor requests use the correct overlay version.
* Disk-based commands use saved source unless explicitly connected to an active editor session.
* Overlay results must not be published as disk-state results.
* Closing or abandoning an overlay removes its session-local semantic state.
* Repeated edits must never expose source ranges or offsets from an incompatible document version.
* Saving a document transitions the corresponding semantic state into the persisted or disk-backed revision through the normal validation and publication lifecycle.

### 4.18 Warm Start and Cache Validation

When a compatible, complete, and validated persisted snapshot exists, GMLoop should provide a zero-reanalysis warm start.

A validated warm request should require:

* No GML parsing for unchanged files.
* No full source-content scan when metadata or stored fingerprints are sufficient.
* No reconstruction of already valid project-wide semantic relationships.
* No avoidable blocking before cached navigation and documentation data become available.

A true cold start occurs when no compatible validated cache exists. A true cold start may require parsing and semantic analysis.

During a true cold start:

* Lexical syntax highlighting must remain available.
* Built-ins must remain available.
* Open and focused files must be prioritized.
* Tier 1 results must be published progressively.
* Tier 2 must continue without blocking Tier 1 editor interaction.

Cache freshness may be validated through:

* Project manifests.
* File metadata.
* Stored content hashes.
* Configuration fingerprints.
* Runtime fingerprints.
* Built-in-definition fingerprints.
* Filesystem change journals.
* Watcher state.
* Other deterministic validity checks.

Cache validation must not trust stale or incompatible persisted data over newer source or project inputs.

### 4.19 Scoped Invalidation and Incremental Reanalysis

Ordinary edits to a known source file must not trigger parsing of unrelated GML source files.

Invalidation must begin from the changed semantic inputs and propagate through the dependencies that consume those inputs.

Propagation must be:

* Scoped.
* Transitive where required.
* Output-sensitive.
* Revision-aware.
* Deterministic in result.
* Conservative when dependency information is incomplete.

When a dependent result is recomputed and its relevant semantic output is unchanged, propagation should stop at that boundary.

Examples include:

* Changing a local variable should not invalidate unrelated files.
* Changing a function body should not invalidate callers when its consumed signature and semantic summary remain unchanged.
* Changing a function signature may invalidate callers.
* Changing a parent object's effective interface may invalidate descendants.
* Changing a parent implementation without changing inherited semantic facts should not rebuild descendant member tables.
* Changing a macro or project-global semantic input may require broad invalidation.
* Changing resource metadata may invalidate resource consumers.
* Changing built-in definitions may invalidate all code that depends on those definitions.

Known edits must parse each impacted file at most once per required tier and project revision.

The parser may reparse an entire changed file. Token-level or subtree-level incremental parsing is not required unless demonstrated to be correct and beneficial.

Semantic binding, type inference, relationship generation, and dependent recomputation should be scoped more finely where practical.

### 4.20 Full-Project Invalidation Exceptions

Full-project invalidation is permitted only when a narrower valid dependency closure cannot be proven or when a project-global semantic input changes.

Valid causes may include:

* Parser grammar changes.
* Semantic-engine version changes.
* Persistent-schema incompatibility.
* GameMaker runtime-target changes.
* Built-in-definition changes.
* Project configuration changes.
* Resource-manifest changes with project-wide effects.
* Extension changes.
* Included-package changes.
* Macro or preprocessing changes with project-wide effects.
* Corrupt or missing dependency metadata.
* Cache corruption.
* Path-normalization or project-identity changes.
* Explicit clean or rebuild operations.

Full invalidation must be explicit and diagnosable.

The system must not silently perform broad invalidation while reporting that an incremental update occurred.

### 4.21 Persistent Store Requirements

The persistent semantic store must support:

* Schema versioning.
* Parser-version tracking.
* Semantic-engine-version tracking.
* Runtime and built-in-definition fingerprints.
* Project-configuration fingerprints.
* Project identity.
* File identity.
* Content fingerprints.
* Semantic fingerprints.
* Atomic transactions or equivalent atomic publication.
* Crash-safe writes.
* Concurrent readers.
* Defined writer coordination.
* Recovery from interrupted writes.
* Detection of corrupt or incomplete data.
* Migration or deterministic rebuild behavior.
* Removal of obsolete revisions.
* Cache-size management.
* New files.
* Deleted files.
* Moved files.
* Renamed files.
* Project relocation.
* Path normalization.
* Case-sensitivity differences between filesystems.

Dry runs must not mutate:

* Source files.
* Project metadata.
* Persistent semantic storage.
* Cache metadata.
* Session overlays.
* Current published snapshots.

The target state does not require a specific database or serialization technology.

### 4.22 Determinism

Semantic output must be deterministic for the same complete set of project inputs.

Deterministic output includes:

* Symbol identities within the documented identity model.
* Symbol ordering where externally observable.
* Diagnostics.
* Reference results.
* Inheritance relationships.
* Dependency results.
* SCIP output.
* Rename plans.
* Codemod plans.
* Transpilation-relevant semantic facts.
* Persistent semantic fingerprints.

Internal work scheduling, thread assignment, queue order, or processing order may differ as long as externally observable results remain equivalent.

### 4.23 Documentation and Hover

Every supported symbol kind must be capable of carrying structured documentation.

Documentation extraction must support:

* Description text.
* Parameters.
* Return values.
* Types.
* Repeated tags.
* Malformed tags.
* Missing tags.
* Constructor documentation.
* Method documentation.
* Field documentation.
* Resource documentation where available.
* Built-in documentation.
* Extension-provided documentation.

Malformed documentation must not corrupt symbol indexing.

Hover must:

* Operate against one compatible semantic revision.
* Avoid direct definition-file I/O when the required documentation is already indexed.
* Report exact symbol and type information when available.
* Represent uncertainty explicitly.
* Avoid shifted or stale ranges after repeated edits.
* Remain available for built-ins without requiring a project cache.
* Bind active-file occurrences on demand when the full reverse-reference index is unavailable.

Lexical ranges should be computed no more than once per document version unless invalidated by a relevant change.

### 4.24 Project-Wide Rename Safety

Project-wide rename must be driven by resolved semantic facts, never by unverified textual or structural heuristics.

Before producing edits, the refactor engine must determine:

* The exact target symbol.
* The target's ownership and scope.
* The rename family.
* All exact definitions and references.
* Relevant candidate, ambiguous, dynamic, and unresolved occurrences.
* Inheritance and override relationships.
* Constructor and member relationships.
* Resource relationships.
* Call and dispatch relationships.
* Built-in and reserved-name constraints.
* Shadowing and capture risks.
* Duplicate declaration risks.
* Target-name collisions.
* Cross-file consistency.
* Generated or project-metadata references.
* String-based references that can be proven relevant.
* The compatible project revision.

A rename family may include:

* One local declaration.
* One parameter.
* One field.
* One constructor-owned field.
* One script.
* One resource.
* One override family.
* One inherited-member family.
* One generated or project-linked declaration family.

The rename engine must not assume that all identically spelled occurrences belong to the target.

### 4.25 Rename Blocking Rules

A project-wide rename must fail before mutating source when safety cannot be proven.

A non-exact occurrence must block rename when it:

* Could refer to the target symbol.
* Could become bound to the proposed target name.
* Could be captured by the rename.
* Could introduce ambiguity.
* Could change dispatch.
* Could change inheritance or override behavior.
* Could create mixed old and new naming.
* Otherwise intersects the rename's semantic safety closure.

An unrelated unresolved occurrence elsewhere in the project must not automatically block the rename when the semantic system can prove it cannot refer to the target and cannot interact with the proposed name.

When rename is blocked, the command must:

* Exit with a non-zero status where applicable.
* Produce explicit diagnostic errors.
* Identify the blocking occurrences.
* Explain the uncertainty or collision.
* Make no partial source edits.
* Make no persistent semantic-store mutation.

### 4.26 Reserved and Built-In Identifier Rules

The rename engine must distinguish symbol ownership from spelling.

The following must be rejected:

* Renaming a GameMaker-owned built-in declaration.
* Renaming a reserved language identifier.
* Renaming to a syntactically invalid identifier.
* Renaming to a name that would introduce invalid shadowing, ambiguity, capture, dispatch changes, or behavior changes.
* Renaming a symbol whose identity is fixed by the GameMaker runtime or project format.

A user-owned symbol that currently has the same spelling as a built-in must still be recognized as user-owned.

The engine must permit renaming such a user-owned symbol away from the built-in spelling when doing so is otherwise safe.

Renaming to a built-in spelling may be rejected conservatively unless the semantic system can prove that the result is valid and behavior-preserving in every affected scope.

### 4.27 Rename Planning and Application

Rename must be performed as an atomic semantic transaction.

#### Preflight

The preflight stage must:

1. Resolve the selected occurrence to an exact target symbol.
2. Determine the rename family.
3. Collect all affected exact occurrences.
4. Identify relevant non-exact occurrences.
5. Simulate name lookup using the proposed name.
6. Detect duplicate declarations.
7. Detect shadowing.
8. Detect capture.
9. Detect built-in and reserved-name conflicts.
10. Detect inheritance and override conflicts.
11. Detect dispatch changes.
12. Detect resource-name conflicts.
13. Detect generated-name conflicts.
14. Detect rename cycles.
15. Validate document versions and the project revision.
16. Produce a complete edit plan without mutating source.

#### Application

The application stage must:

1. Apply all planned edits atomically.
2. Avoid publishing intermediate mixed-name states.
3. Reparse affected files.
4. Rebuild affected file-local semantic results.
5. Recompute affected semantic relationships.
6. Resolve all edited occurrences again.
7. Verify that each occurrence resolves to the intended post-rename symbol.
8. Verify that unrelated previously resolved occurrences have not changed binding.
9. Verify that no new ambiguity, collision, or capture was introduced.
10. Run configured parsing, semantic, and compilation validation.
11. Commit the transaction only if all required validation succeeds.
12. Roll back or leave source unmodified if validation fails.

A rename cycle such as:

```text
a -> b
b -> a
```

must either be executed atomically without exposing intermediate collisions or rejected before source mutation.

### 4.28 Refactor Equivalence Requirements

General program equivalence is not a practical proof obligation.

For rename and equivalent binding-preserving refactors, correctness means:

* All intended definitions are updated.
* All exact intended references are updated.
* Every updated occurrence resolves to the corresponding post-refactor symbol.
* No previously resolved unrelated occurrence changes binding.
* No new duplicate declaration is introduced.
* No new shadowing or capture is introduced.
* No unintended dispatch change is introduced.
* No unintended inheritance or override change is introduced.
* No mixed old and new naming remains.
* Dynamic or reflective references are handled according to the operation's declared safety policy.
* The transformed project passes required parsing and semantic validation.
* The transformed project passes configured build or compilation validation where available.

### 4.29 Codemod Requirements

Semantic codemods must operate against a complete compatible semantic snapshot whenever their correctness depends on project-wide meaning.

Codemods must:

* Declare the semantic facts they require.
* Declare whether Tier 1 or Tier 2 is sufficient.
* Perform a whole-operation preflight.
* Avoid unbounded edit accumulation.
* Avoid unbounded content-overlay growth.
* Bound memory through streaming, chunking, or scoped materialization where appropriate.
* Detect target collisions.
* Detect circular transformations.
* Validate cross-file consistency.
* Apply edits atomically where partial application would be unsafe.
* Avoid mutating source or persistent state during dry runs.
* Produce deterministic plans for identical inputs.
* Revalidate affected semantic bindings after transformation.

A codemod must not silently skip an occurrence whose omission would produce a partially transformed or semantically inconsistent result.

### 4.30 Performance and Memory Requirements

The semantic architecture must:

* Avoid monolithic full-project identifier accumulation where a scoped or indexed representation is sufficient.
* Avoid requiring all project semantic data to be materialized simultaneously.
* Support bounded-memory processing.
* Support streaming or chunked serialization.
* Support replaceable file-local semantic results.
* Support compact symbol, type, scope, file, and occurrence identities.
* Support fast symbol lookup.
* Support fast source-position lookup.
* Support fast definition lookup.
* Support fast reverse-reference lookup.
* Support fast direct inheritance lookup.
* Support efficient descendant traversal.
* Support output-sensitive invalidation.
* Avoid deep duplicated relationship structures.
* Avoid unbounded edit overlays.
* Avoid increasing process heap limits as the primary scalability solution.

Performance optimizations must not weaken semantic correctness or snapshot consistency.

### 4.31 Expected Incremental Behavior

The target architecture should support behavior equivalent to:

```text
Ordinary implementation edit:
  Reparse the changed file.
  Recompute affected local semantics.
  Recompute demanded dependents only when their consumed semantic facts changed.

Local rename:
  Update the declaration and exact references in its scope.
  Validate capture and shadowing.
  Avoid unrelated project work.

Function signature change:
  Recompute the function summary.
  Invalidate callers and other signature consumers transitively.
  Stop where dependent outputs remain semantically unchanged.

Parent-object interface change:
  Recompute direct descendant effective-member results.
  Propagate transitively only through descendants whose effective semantic result changes.

Resource rename:
  Update exact semantic resource references and project metadata.
  Block when relevant dynamic resource lookup cannot be handled safely.

Find All References:
  Read the complete reverse-reference index for a compatible Tier 2 revision.

Warm editor startup:
  Restore and validate the persisted semantic snapshot without reparsing unchanged files.

Unsaved edit:
  Publish a new editor-session overlay revision without changing unrelated disk-based consumers.
```

### 4.32 Observability and Testing

The semantic system must expose enough structured information to test and diagnose:

* Project revision identity.
* Snapshot tier.
* Cache validity.
* Changed inputs.
* Parsed files.
* Reanalyzed files.
* Invalidated symbols.
* Invalidated queries.
* Reused semantic results.
* Propagation boundaries.
* Semantic fingerprints.
* Full-project invalidation causes.
* Blocking semantic gaps.
* Rename safety decisions.
* Persistent-store mutations.
* Worker and watcher shutdown.

Tests should verify semantic stability rather than storage-byte stability.

For unaffected semantic data, tests should verify that:

* Stable identities are retained where promised.
* Semantic fingerprints remain unchanged.
* Records are not unnecessarily deleted or recomputed.
* Unrelated definitions and occurrences remain semantically equivalent.
* No unrelated source file is parsed for an ordinary known-file edit.
* No stale revision is published.
* No partial Tier 1 result is returned as a complete Tier 2 result.
* Dry runs perform no persistent or source mutation.
* Shutdown leaves no owned work active.

### 4.33 Goals

1. Provide one authoritative semantic model for every GMLoop consumer.
2. Resolve all statically determinable GML references.
3. Represent dynamic and uncertain behavior explicitly and conservatively.
4. Make project-wide rename and codemod operations provably safe within their declared semantic scope.
5. Support fast definition, reference, scope, type, inheritance, and dependency lookup.
6. Support output-sensitive cascading when parents, signatures, resources, or other dependencies change.
7. Avoid reparsing unrelated source files for ordinary edits.
8. Provide rapid Tier 1 editor functionality while Tier 2 relationships are built.
9. Provide zero-reanalysis warm starts from compatible validated caches.
10. Maintain immutable, revision-consistent semantic snapshots.
11. Keep unsaved editor overlays isolated from unrelated disk-based consumers.
12. Reduce peak RSS and heap use through bounded-memory processing.
13. Avoid monolithic full-project in-memory aggregates.
14. Preserve deterministic output while allowing internal parallelism and processing-order differences.
15. Prevent unbounded edit, overlay, cache, and intermediate-result growth.
16. Support crash-safe and concurrent persistent-cache use.
17. Provide explicit diagnostics for semantic gaps and broad invalidation.
18. Keep the design independent of a specific programming language, database, serializer, or incremental-query framework.

### 4.34 Non-Goals and Antipatterns

1. Using SCIP as the complete internal semantic model.
2. Treating references as equivalent to compilation dependencies.
3. Claiming exact static resolution for fundamentally dynamic runtime behavior.
4. Silently guessing unresolved symbol targets.
5. Silently skipping occurrences during safety-critical refactors.
6. Blocking every rename because of unrelated unresolved code.
7. Combining semantic resolution with one fixed JavaScript-emission strategy.
8. Representing the entire project as one giant mutable graph.
9. Mutating published semantic snapshots in place.
10. Persisting unsaved editor buffers as shared disk state by default.
11. Treating the persistent cache as more authoritative than source and project inputs.
12. Requiring every process to share one literal in-memory cache object.
13. Performing full-project parsing for an ordinary known-file edit.
14. Promising zero work on a true cold start.
15. Increasing `max-old-space-size` as the primary scalability solution.
16. Introducing broad user-facing configuration for internal semantic-pipeline details.
17. Rewriting unrelated formatter or linter architecture.
18. Adding vector-database-style retrieval to semantic analysis.
19. Requiring byte-for-byte storage stability for semantically unchanged records.
20. Locking the target architecture to SQLite or another specific storage engine.
21. Requiring token-level incremental parsing without evidence that it is necessary.
22. Treating general program equivalence as a mechanically provable requirement.
23. Publishing stale or mixed-revision semantic results.
24. Returning incomplete Tier 1 data as complete project-wide analysis.

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
