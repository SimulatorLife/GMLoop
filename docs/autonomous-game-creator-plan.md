# Autonomous GameMaker Creator Plan

GMLoop has the lower-level ingredients for agent-assisted GameMaker development: parser, formatter, lint rules, refactors, semantic indexing, transpilation, runtime hot reload, a CLI, UI surfaces, fixture infrastructure, and an MCP workspace. The next step is to make those tools a first-class GameMaker companion surface through which externally coordinated agents can design, modify, test, build, run, and iteratively improve complete GameMaker projects.

The target is not merely an agent that writes `.gml` files. The target is a GameMaker-specific tooling platform where agents can safely mutate real GameMaker resources, reuse known-good gameplay systems, run validation, and collect evidence. The official GameMaker CLI (`gm-cli`) and its ResourceTool MCP server should be used alongside GMLoop for the project/resource/build/manual/publish capabilities they already own. GMLoop should complement that surface with semantic graph context, validation, lint/format/refactor workflows, hot reload, task evidence, and missing high-level automation. External agent coordinators own task splitting, scheduling, routing, approvals, retries, and long-running automation state. The primary runtime target is GameMaker HTML5, with GMLoop hot-reload functionality as the default iteration loop so agents can quickly change gameplay code/resources, observe results, inspect diagnostics, and keep developing without slow full rebuild cycles whenever hot reload can provide a valid proof step.

## 1. Foundation and Target Direction

The target platform builds on these responsibilities:

- `@gmloop/parser` for GML parsing.
- `@gmloop/format` for deterministic GML formatting.
- `@gmloop/lint` for diagnostics and autofixes.
- `@gmloop/refactor` for project-aware codemods, cross-file edits, and project-resource mutations.
- `@gmloop/semantic` for project indexing, symbols, graph queries, and context retrieval.
- `@gmloop/transpiler` for GML-to-JavaScript emission.
- `@gmloop/runtime-wrapper` for hot-reload and HTML5 runtime integration.
- `@gmloop/cli` as the canonical command surface.
- `@gmloop/ui` for browser-facing visualization and interaction.
- `@gmloop/mcp` as the agent exposure layer for CLI-backed tools and graph resources.
- Optional external agent coordinators and CI workflows that consume GMLoop's stable local contracts.
- [YoYoGames/gm-cli](https://github.com/YoYoGames/gm-cli) as the official GameMaker command-line tool for project creation, ResourceTool edits, compile/run/package workflows, manual lookup, GX.Games publishing, and its own ResourceTool MCP mode.

The target state is a reusable GameMaker companion layer with rich project mutation APIs, build/run/test loops, game-design skills, helper libraries, task evidence, and clean integration with the official GameMaker CLI ecosystem. GMLoop and `gm-cli` are complementary tool surfaces: GMLoop should add GameMaker-specific intelligence and automation where it owns unique value, while agents can call `gm-cli` / ResourceTool MCP directly for official lifecycle operations. It is not a general agent operating system or workflow engine.

## 2. MCP Role and Architectural Boundary

`@gmloop/mcp` is already the agent-facing transport and exposure layer. It should not be treated as missing infrastructure that needs to be reinvented.

The current and target layering is:

```text
GameMaker domain behavior and project/resource mutation logic
  -> CLI commands and structured output
    -> MCP tool exposure derived from the CLI catalog
  -> external agent clients and coordinators
```

This means new autonomous-game capabilities should generally extend existing domain behavior and CLI commands first. Once the CLI command is in the catalog, the existing MCP server should expose it to agents without duplicating command behavior inside `@gmloop/mcp`.

Important nuance: GMLoop MCP can expose high-level tools where GMLoop adds project intelligence, validation, hot reload, graph context, test evidence, or missing automation. It should not mirror the official ResourceTool MCP catalog just to put the same operation under a `gmloop_` name. Agents should be expected to use both MCP servers when both are configured.

MCP-specific work should be limited to:

- preserving the CLI-derived tool generation contract
- improving schema generation where CLI metadata is insufficient
- returning structured command results clearly to agents
- exposing read-only resources such as graph/context resources
- testing that supported CLI commands appear correctly in the MCP catalog

MCP should not duplicate domain implementations that already belong below the CLI boundary. For example, if `resource add` creates a GameMaker resource and updates the manifest, MCP should expose that capability by calling the CLI-backed tool, not by separately editing `.yyp` / `.yy` files.

## 3. Target Capability Surface

This plan should describe where the system is headed rather than maintain a live inventory of which commands are implemented. Keep implementation status in issues, PRs, tests, and command help output; keep this document focused on durable target-state guidance.

The autonomous creation surface should converge on these durable capabilities:

- project and resource creation, deletion, duplication, rename, movement, and validation through the right companion surface: official `gm-cli` / ResourceTool MCP for official metadata operations, and GMLoop for graph-aware validation, orchestration, hot reload, and missing automation;
- object, event, room, layer, camera, sprite, sound, shader, script, path, timeline, font, sequence, tile set, and included-file operations where they are meaningful for autonomous creation;
- high-level GameMaker operations that hide `.yyp` and `.yy` structure from agents while preserving exact metadata correctness through the official provider or a GMLoop-owned extension as appropriate;
- graph-backed project inspection and context retrieval for planning edits;
- structured dry-run and write modes for mutations;
- deterministic JSON summaries for CLI users and MCP consumers;
- HTML5-first playtest and runtime inspection workflows that use GMLoop hot reload as the fast path for iterative development;
- validation flows that format, lint, test, build, run, inspect logs, and iterate from failures;
- integration with `gm-cli` where the official tool is the right owner for project initialization, ResourceTool operations, runtime/toolchain management, compile/run/package, manual search, and publishing.

## 4. YoYoGames `gm-cli` Integration Target

`gm-cli` is an official command-line interface for editing, compiling, packaging, and running GameMaker projects. It should be treated as a first-class companion surface, not as a competitor to GMLoop and not merely as an implementation detail hidden behind GMLoop.

Target relationship:

- GMLoop owns GML analysis, formatting, linting, semantic graph/context, refactors, hot reload, structured workflow actions and evidence, and the agent-facing command catalog.
- `gm-cli` owns official GameMaker project initialization, runtime/toolchain acquisition, compile/run/package behavior, ResourceTool capabilities, manual lookup, and publish flows where those official paths are available and reliable.
- GMLoop may call `gm-cli` behind typed provider interfaces when a GMLoop-owned workflow needs official tool output, such as build evidence, artifact paths, or ResourceTool results combined with graph-aware validation.
- GMLoop should not expose a duplicate `gmloop_*` tool for every official `gm-cli` / ResourceTool command. If the official MCP tool already serves the agent workflow, agents should use that tool directly alongside GMLoop.
- GMLoop should expose `gm-cli`-informed operations through its normal CLI command catalog only when the command adds GMLoop-owned value such as semantic context, validation, dry-run planning, hot reload, test evidence, or workflow aggregation.
- GMLoop should not reimplement official `gm-cli` behavior purely to avoid invoking it. Reimplementation is justified only when GMLoop needs tighter semantic integration, deterministic fixture-mode tests, hot-reload-specific behavior, or capabilities that `gm-cli` does not provide.
- Before implementing a project/resource/build command, check the current `gm-cli` command catalog and ResourceTool MCP catalog. If a matching official operation exists, decide whether agents should call it directly or whether GMLoop adds enough unique value to justify a companion command.
- Use `gmloop gm-cli capability-audit --json` as the local boundary check before adding autonomous-game creation commands. It reports direct official-tool capabilities, GMLoop companion commands, GMLoop-native gaps, placeholders, and unavailable official catalog entries.
- `gm-cli resourcetool mcp` should be a normal companion MCP server in autonomous workflows. GMLoop's MCP server should remain catalog-derived from GMLoop CLI commands rather than becoming a proxy full of ResourceTool duplicates.
- `gm-cli manual` can provide official GameMaker documentation lookup for agents; GMLoop should prefer structured, citation-friendly summaries over asking agents to infer API behavior from memory.
- `gm-cli run`, `compile`, and `package` should be candidates for the real build/run provider, with fixture/mock providers retained for tests and environments without a GameMaker toolchain.
- `gm-cli gxgames` should be considered the publishing provider when autonomous workflows reach packaging and release stages.

Required integration constraints:

- Detect `gm-cli` availability and version explicitly.
- Keep all invocations non-interactive for automated workflows unless a command is intentionally documented as human-driven.
- Capture stdout, stderr, exit code, generated artifact paths, logs, and relevant environment/toolchain metadata.
- Avoid leaking provider-specific flags into the high-level agent surface unless the flag is part of a real user contract.
- Add fixture-mode tests around provider parsing and error shaping so the repository can validate behavior without requiring local GameMaker credentials or runtimes.
- Document provider requirements only where command behavior depends on external installation, authentication, target platform, or GameMaker runtime availability.

## 5. Guiding Principles

1. **Agents should use high-level GameMaker operations, not raw file edits.**
   Editing `.yyp` and `.yy` files directly is fragile. Agents should call high-level commands such as resource, object, room, test, and build operations. The command implementation should handle the underlying GameMaker metadata safely.

2. **Use and extend existing abstractions first.**
   Before adding a new workspace or API, check whether the capability belongs in the existing `resource`, `object`, `room`, `project`, `runner`, `test`, `refactor`, `semantic`, or provider-integration paths. Prefer direct use of official `gm-cli` / ResourceTool MCP capabilities when they already serve the workflow.

3. **CLI is the source of truth for agent tools.**
   New autonomous-game behavior should be added as CLI commands with structured output. MCP should expose those commands by deriving tools from the CLI command catalog, not by defining parallel MCP-only tools.

4. **MCP is already the right exposure layer.**
   The plan should extend what MCP can expose by filling real capabilities underneath it, not by inventing a second agent API.

5. **Validation must close the loop.**
   The system must be able to format, lint, test, build, run, inspect logs, and iterate from failures. Autonomous game creation is not reliable without an automated proof step.

6. **Official tools should be companions, not shadows.**
   When `gm-cli` provides a stable project, ResourceTool, build, run, package, manual, or publish capability, agents may use that official tool directly. GMLoop should add a separate command only when it contributes GMLoop-owned context, validation, hot reload, refactor planning, task evidence, or missing automation.

7. **Reusable building blocks beat repeated invention.**
   Agents should compose known-good helpers, systems, templates, and prefabs instead of inventing new state machines, input systems, cameras, and UI primitives every time.

8. **External coordinators should coordinate agents.**
   GMLoop should return deterministic, machine-readable results and task evidence. External coordinators own splitting, claiming, blocking, scheduling, retries, and completion state.

9. **Game design context is as important as code context.**
   Agents need skills and prompts for core loops, player agency, feedback, juice, scope, loss/win criteria, progression, balancing, and vertical-slice planning.

## 6. CLI/MCP Command Contract

The CLI/MCP command surface is part of the autonomous creation target state. It should remain stable, discoverable, and machine-readable enough for agents to plan and execute work without parsing human prose.

### Decisions

| Decision                    | Target                                                                                                                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI naming                  | Use domain-noun top-level commands with short verb subcommands: `resource add`, `room list`, `runner logs`, `symbol inspect`.                                                                      |
| MCP naming                  | Derive tool names from CLI leaf paths with a `gmloop_` prefix and underscores, such as `gmloop_resource_add`, `gmloop_graph_search`, and `gmloop_runner_logs`.                                     |
| CLI source of truth         | The `@gmloop/cli` command catalog defines the canonical public agent-control surface.                                                                                                              |
| MCP architecture            | `@gmloop/mcp` remains a thin wrapper over the CLI catalog. It should not define standalone command tools or duplicate command business logic.                                                      |
| Runtime target              | Design the agent surface for GameMaker HTML5, GMLoop hot reload, and official GameMaker toolchain integration rather than generic desktop IDE automation.                                          |
| Browser automation boundary | Do not recreate browser automation already handled by Playwright/browser MCP servers, such as screenshots, keyboard input, mouse input, browser navigation, DOM inspection, or viewport emulation. |
| Standalone vs options       | Prefer one command per domain action and move getter/setter expansion into `inspect`, `update`, `validate`, `query`, `state`, `logs`, `capture`, and `report` subcommands with explicit options.   |
| Graph commands              | Keep graph-wide commands under `graph`; place symbol-centric queries under a separate `symbol` suite for AI ergonomics.                                                                            |
| Symbol inspection           | Use `symbol inspect` as the unified symbol entrypoint instead of builtin-only special-case commands.                                                                                               |
| Legacy prefixes             | Do not use `gml_` prefixes. Keep CLI command names unprefixed and reserve `gmloop_` for MCP tool names.                                                                                            |

### Contract Rules

| Rule                         | Requirement                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source of truth              | If a capability should be exposed to AI agents, it must first exist as a real CLI command/subcommand.                                                                                                         |
| MCP derivation               | Every MCP command tool must be generated from the CLI command catalog and mirror the CLI leaf command name, description, arguments, and options.                                                              |
| No standalone MCP tools      | Do not add handwritten, static, predefined, or MCP-only command tools.                                                                                                                                        |
| No parallel command surfaces | Do not create capabilities that exist only in MCP and not in the CLI.                                                                                                                                         |
| DRY schema ownership         | Argument parsing, option names, defaults, validation, and help text should be owned once by the CLI and reused by MCP generation.                                                                             |
| Change workflow              | To add, remove, or rename an MCP command tool, change the CLI command definition.                                                                                                                             |
| Resources exception          | MCP resources may still exist for read-only graph/context/project views, but command-like behavior must come from CLI-derived tools.                                                                          |
| Browser-tool exception       | Browser automation primitives should be delegated to Playwright/browser MCP tooling rather than reimplemented in `@gmloop/mcp`.                                                                               |
| External tool strategy       | When `gm-cli`, Stitch, or another proven package owns a GameMaker project, launcher, ResourceTool, or build concern well, use it as a companion surface or narrow dependency rather than reimplementing it. |

### External Tooling Strategy

| Source                                                                                                 | Target use                                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [YoYoGames/gm-cli](https://github.com/YoYoGames/gm-cli)                                                | Official companion surface and first ownership check for project creation, ResourceTool edits, compile/run/package, runtime/toolchain handling, manual lookup, MCP ResourceTool interoperability, and publishing. |
| [bscotch/stitch](https://github.com/bscotch/stitch)                                                    | Reference for GameMaker project automation patterns and possible reusable implementation ideas where they fit GMLoop boundaries.                                                                  |
| [bscotch/stitch `packages/yy`](https://github.com/bscotch/stitch/tree/develop/packages/yy)             | Reference or dependency candidate for `.yy`/`.yyp` schema handling when it avoids duplicating GameMaker metadata logic.                                                                           |
| [bscotch/stitch `packages/launcher`](https://github.com/bscotch/stitch/tree/develop/packages/launcher) | Reference or dependency candidate for launch/runtime/build orchestration where it fits the HTML5/hot-reload workflow.                                                                             |
| GameMaker manual command-line build docs                                                               | Official reference for GameMaker build invocation behavior and supported flags.                                                                                                                   |
| YoYo Games build automation guidance                                                                   | Reference for supported GameMaker build automation and CI patterns.                                                                                                                               |
| Adjacent GameMaker MCP servers                                                                         | Comparison points for scope decisions, not the source of truth for GMLoop's MCP design.                                                                                                           |

### Target CLI Taxonomy

| Top-level command  | Purpose                                                                       | Primary backing workspace(s)                                            |
| ------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `graph`            | Build, query, diagnose, and visualize the semantic graph index.               | `@gmloop/semantic`, `@gmloop/ui`                                        |
| `symbol`           | Inspect symbols, context, usages, and relationships.                          | `@gmloop/semantic`                                                      |
| `validate`         | Validate GML files, projects, rooms, and resources.                           | `@gmloop/parser`, `@gmloop/semantic`, `@gmloop/refactor`                |
| `project`          | Inspect, validate, prepare, and augment projects with GMLoop-specific setup. Official creation/initialization may stay on `gm-cli` / ResourceTool MCP unless GMLoop adds companion value. | `@gmloop/cli`, `@gmloop/refactor`, `gm-cli` companion providers         |
| `resource`         | Inspect, validate, and augment project resource inventory with graph/refactor context. Official resource creation/editing may stay on ResourceTool MCP unless GMLoop adds companion value. | `@gmloop/semantic`, `@gmloop/refactor`, `gm-cli` ResourceTool companion |
| `room`             | Inspect, validate, preview, and mutate rooms, instances, layers, and cameras. | `@gmloop/semantic`, `@gmloop/refactor`, `@gmloop/ui`                    |
| `object`           | Inspect, validate, and mutate object properties and events.                   | `@gmloop/semantic`, `@gmloop/refactor`                                  |
| `runner` or `game` | Build, run, package, check, log, and manage GameMaker process lifecycle.      | `@gmloop/cli`, `@gmloop/runtime-wrapper`, `gm-cli` providers            |
| `runtime`          | Inspect and mutate live in-game state through the runtime wrapper.            | `@gmloop/runtime-wrapper`, `@gmloop/transpiler`, `@gmloop/cli`          |
| `profile`          | Capture runtime performance snapshots and reports.                            | `@gmloop/runtime-wrapper`, `@gmloop/cli`                                |
| `test`             | Discover, author, run, parse, and report tests.                               | `@gmloop/cli`, `@gmloop/runtime-wrapper`                                |
| `replay`           | Record, run, compare, and assert deterministic sessions.                      | `@gmloop/runtime-wrapper`, `@gmloop/cli`                                |
| `kit`              | List, inspect, and import reusable GML helpers/templates.                     | `@gmloop/cli`, future `@gmloop/gml-kit`, `@gmloop/refactor`             |
| `ui`               | Validate, preview, and scaffold GMLoop UI-facing artifacts.                   | `@gmloop/ui`, `@gmloop/refactor`, `@gmloop/cli`                         |

### Canonical Agent Command Surface

| Capability                           | Target CLI commands                                                                                                                    | Target MCP names                                                                                                                                         | Primary owner                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Graph index and discovery            | `graph index`, `graph search`, `graph doctor`, `graph visualize`                                                                       | `gmloop_graph_index`, `gmloop_graph_search`, `gmloop_graph_doctor`, `gmloop_graph_visualize`                                                             | `@gmloop/semantic`, `@gmloop/ui`         |
| Symbol inspection and relationships  | `symbol inspect`, `symbol context`, `symbol neighbors`, `symbol usages`                                                                | `gmloop_symbol_inspect`, `gmloop_symbol_context`, `gmloop_symbol_neighbors`, `gmloop_symbol_usages`                                                      | `@gmloop/semantic`                       |
| Validation                           | `validate file`, `validate project`, `validate room`, `validate resource`                                                              | `gmloop_validate_file`, `gmloop_validate_project`, `gmloop_validate_room`, `gmloop_validate_resource`                                                    | parser/semantic/refactor                 |
| Project lifecycle                    | `project create`, `project init`, `project inspect`, `project validate`, `project cache clean`                                         | `gmloop_project_create`, `gmloop_project_init`, `gmloop_project_inspect`, `gmloop_project_validate`, `gmloop_project_cache_clean`                        | CLI/refactor plus `gm-cli` as a companion surface; expose GMLoop commands only where they add GMLoop-owned value |
| Resource inventory                   | `resource list`, `resource find`, `resource inspect`, `resource deps`, `resource dependents`, `resource audit`                         | `gmloop_resource_list`, `gmloop_resource_find`, `gmloop_resource_inspect`, `gmloop_resource_deps`, `gmloop_resource_dependents`, `gmloop_resource_audit` | semantic                                 |
| Resource mutations                   | `resource add`, `resource remove`, `resource rename`, `resource duplicate`, `resource move`                                            | `gmloop_resource_add`, `gmloop_resource_remove`, `gmloop_resource_rename`, `gmloop_resource_duplicate`, `gmloop_resource_move`                           | ResourceTool MCP for official edits; GMLoop commands only for graph-aware, refactor-aware, hot-reload-aware, or missing operations |
| Room inspection and analysis         | `room list`, `room inspect`, `room query`, `room validate`, `room preview`, `room summary`                                             | `gmloop_room_list`, `gmloop_room_inspect`, `gmloop_room_query`, `gmloop_room_validate`, `gmloop_room_preview`, `gmloop_room_summary`                     | semantic/ui                              |
| Room mutations                       | `room create`, `room duplicate`, `room rename`, `room delete`, `room update`, `room repair`                                            | `gmloop_room_create`, `gmloop_room_duplicate`, `gmloop_room_rename`, `gmloop_room_delete`, `gmloop_room_update`, `gmloop_room_repair`                    | refactor                                 |
| Room instances                       | `room instance add`, `room instance update`, `room instance delete`                                                                    | `gmloop_room_instance_add`, `gmloop_room_instance_update`, `gmloop_room_instance_delete`                                                                 | refactor/semantic                        |
| Room layers and cameras              | `room layer list/inspect/create/update/delete/reorder/move-resource`, `room camera list/inspect/update/frame`                          | Derived from the CLI leaf path, for example `gmloop_room_layer_create` and `gmloop_room_camera_update`                                                   | refactor/semantic                        |
| Object inspection and mutation       | `object list`, `object inspect`, `object update`, `object validate`, `object event list/inspect/add/update/delete`                     | Derived from the CLI leaf path, for example `gmloop_object_event_update`                                                                                 | semantic/refactor                        |
| Build, run, package, and logs        | `game build`, `game check-build`, `game run`, `game package`, `game logs`, or equivalent `runner` leaves                               | Derived from the CLI leaf path, for example `gmloop_game_build` or `gmloop_runner_logs`                                                                  | CLI/runtime-wrapper/`gm-cli` providers   |
| Live runtime inspection and mutation | `runtime instances`, `runtime inspect`, `runtime get`, `runtime set`, `runtime call`, `runtime watch`, `runtime state`, `runtime logs` | Derived from the CLI leaf path, for example `gmloop_runtime_call`                                                                                        | runtime-wrapper/transpiler/CLI           |
| Profiling                            | `profile start`, `profile stop`, `profile snapshot`, `profile compare`, `profile report`                                               | `gmloop_profile_start`, `gmloop_profile_stop`, `gmloop_profile_snapshot`, `gmloop_profile_compare`, `gmloop_profile_report`                              | runtime-wrapper/CLI                      |
| Tests                                | `test list`, `test run`, `test results`, `test case create`, `test case update`, `test parse-results`, `test report`                   | Derived from the CLI leaf path, for example `gmloop_test_case_create`                                                                                    | CLI/runtime-wrapper                      |
| Replays                              | `replay record`, `replay run`, `replay compare`, `replay assert`                                                                       | `gmloop_replay_record`, `gmloop_replay_run`, `gmloop_replay_compare`, `gmloop_replay_assert`                                                             | runtime-wrapper/CLI                      |
| Helper kit                           | `kit list`, `kit search`, `kit inspect`, `kit import`, `kit dependencies`                                                              | Derived from the CLI leaf path, for example `gmloop_kit_import`                                                                                          | CLI/gml-kit/refactor                     |
| UI validation and scaffolding        | `ui inspect`, `ui validate`, `ui preview`, `ui scaffold`                                                                               | `gmloop_ui_inspect`, `gmloop_ui_validate`, `gmloop_ui_preview`, `gmloop_ui_scaffold`                                                                     | UI/refactor/CLI                          |

### Priority Order for Agent-Facing Work

| Priority | Recommended focus                                                                                                                                                                                                                                                                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | `graph search`, `symbol inspect`, `validate file/project`, `project create/init/validate`, `resource list/find/inspect/add/remove/rename`, `room list/inspect/update/instance add`, `object inspect/update/event update`, build/check/log commands backed by `gm-cli`, and runtime get/set/call/watch where hot reload requires it. |
| Medium   | `resource deps/dependents/audit`, `room preview/query/camera/layer`, `profile`, `test`, `replay`, and `kit` commands.                                                                                                                                                                                                               |
| Low      | Cache cleanup, IDE/open convenience flows, and commands that only wrap editor convenience rather than enabling autonomous agent work.                                                                                                                                                                                               |

### Explicitly Out of Scope for `@gmloop/mcp`

| Capability class                                                  | Reason                                           |
| ----------------------------------------------------------------- | ------------------------------------------------ |
| Browser screenshots and page/video capture                        | Already handled by Playwright/browser MCP tools. |
| Browser keyboard, mouse, and gamepad interaction                  | Already handled by Playwright/browser MCP tools. |
| Browser navigation, DOM inspection, and viewport/device emulation | Already handled by Playwright/browser MCP tools. |
| Generic browser-state observation                                 | Already handled by Playwright/browser MCP tools. |

## 7. Milestone 1: Complete Resource-Aware GameMaker Project Mutation

### Goal

Allow agents to safely inspect and mutate real GameMaker projects through the existing CLI/MCP abstraction rather than ad-hoc file edits.

### Target Direction

Resource-aware commands should let agents modify a GameMaker project through high-level operations while the owning implementation preserves `.yyp`, `.yy`, folder, and resource metadata invariants. The first design question for every project or resource mutation is whether `gm-cli` / ResourceTool already owns the operation and whether agents can call that official MCP tool directly. GMLoop should add a companion command only when it contributes GMLoop-owned value: graph-aware validation, refactor planning, hot-reload coordination, deterministic fixtures, higher-level workflow aggregation, or behavior missing from the official surface.

### Provider Ownership Rule

Do not duplicate official GameMaker project/resource behavior. Target commands such as `project create`, `resource add`, `room create`, or `object update` are possible GMLoop automation contracts, not claims that GMLoop must expose a duplicate for every ResourceTool operation or hand-write every `.yy` / `.yyp` change. Their design order is:

1. Discover whether the current `gm-cli` command catalog or ResourceTool MCP catalog exposes the operation.
2. If the official MCP tool is sufficient, document/use that tool directly in the autonomous workflow.
3. Add a GMLoop companion command only when it adds semantic graph/refactor context, validation evidence, dry-run planning, hot-reload coordination, deterministic fixture behavior, workflow aggregation, or missing capability.
4. Keep direct `.yy` / `.yyp` mutation logic domain-owned under refactor/project-resource APIs, never in MCP and never scattered through command handlers.

### Priority Command Families

The target command surface should cover these operations with structured dry-run and write behavior:

```text
gmloop project create
gmloop project init
gmloop project validate
gmloop object update
gmloop object event add
gmloop object event update
gmloop object event delete
gmloop room instance add
gmloop room instance update
gmloop room instance delete
gmloop room layer create
gmloop room layer update
gmloop room layer delete
gmloop room camera update
gmloop test case create
gmloop test case update
```

Do not add separate MCP-only commands for these. Implement the underlying behavior in the relevant command/domain/refactor layer, then let MCP expose the command catalog.

When a GMLoop command consumes `gm-cli resourcetool`, the command should own only the additional GMLoop contract it adds, such as path resolution into the active graph, dry-run planning, validation evidence, test fixtures, or MCP catalog metadata. Agents should not be forced through GMLoop when the official ResourceTool MCP tool is the clearer direct operation.

### Optional New Domain Layer

A new domain layer may still make sense if the existing refactor/resource code becomes too broad:

```text
src/gamemaker-project
```

or:

```text
src/core/src/gamemaker-project
```

But this should be justified by real duplication or missing shared modeling. Prefer extending existing `@gmloop/refactor` project-resource mutation APIs when the change is a natural continuation of current code.

### Required Behavior

- Preserve valid `.yyp` and `.yy` structure.
- Reuse existing `@gmloop/refactor` resource mutation paths where GMLoop-specific semantic/refactor context is required.
- Use `gm-cli resourcetool` directly or as a narrow dependency where official ResourceTool coverage exists, is more complete, or is safer.
- Generate or preserve stable resource IDs where required.
- Keep folders and resource metadata consistent.
- Support dry-run previews where mutations can write.
- Emit structured JSON summaries for CLI and MCP consumers.
- Include fixture tests for each supported resource mutation.
- Include CLI catalog / MCP catalog tests proving the commands are exposed to agents.

### First Work Slice

The first implementation slice should complete one high-value command family or provider-backed operation rather than create a new parallel surface. Good candidates:

1. Implement `object event add/update/delete` for a minimal event type such as Create or Step.
2. Or implement `room instance add/update/delete` for basic object placement.
3. Or implement `test case create/update` to connect the existing `test` command to a real test-authoring flow.
4. Or add a narrow `gm-cli resourcetool` provider adapter for one mutation class while preserving GMLoop's structured result contract.

The recommended first slice is `object event update`, because it directly enables agents to create a resource with `resource add object ...` and then put behavior into it through an existing command family.

## 8. Milestone 2: Reusable GML Helper Library and Templates

### Goal

Give agents a common library of reusable GML primitives, systems, and project slices so generated games are consistent, testable, and maintainable.

### Proposed Workspace

```text
src/gml-kit
```

This package should contain importable GameMaker assets and metadata, not just TypeScript helpers.

### Library Layers

Organize the kit into three layers.

#### 8.1 Primitives

Small, dependency-light scripts:

```text
math helpers
timers
state machines
signals/events
object pooling
debug logging
input normalization
array/list helpers
struct helpers
save-data helpers
```

#### 8.2 Systems

Multi-resource systems:

```text
input manager
camera controller
save/load system
debug overlay
menu navigation
dialogue runner
inventory system
particle/burst helper
audio manager
unit-test bootstrap
room transition controller
```

#### 8.3 Templates

Composable project slices:

```text
top-down controller
platformer controller
card-shop roguelike shell
racing prototype shell
visual-novel dialogue scene
arcade score-attack loop
turn-based tactics shell
```

### Manifest Format

Each helper/system/template should include agent-readable metadata:

```json
{
    "id": "gmloop.camera.follow_2d",
    "description": "Smooth 2D follow camera for object-centered rooms.",
    "resources": ["scripts/scr_camera_follow", "objects/obj_camera_controller"],
    "dependencies": ["gmloop.math.lerp"],
    "tags": ["camera", "2d", "runtime"],
    "agent_notes": "Use for player-following rooms. Requires a target instance id or object reference.",
    "tests": ["gmloop.camera.follow_2d.basic"]
}
```

### CLI-First Commands

```text
gmloop kit list
gmloop kit search --tag camera
gmloop kit inspect gmloop.camera.follow_2d
gmloop kit import gmloop.camera.follow_2d --path MyGame/MyGame.yyp
gmloop kit dependencies gmloop.camera.follow_2d
```

MCP exposure should come from these CLI commands. `@gmloop/mcp` should not contain separate kit-import logic.

### First Work Slice

Add 5 to 10 tiny helpers first:

```text
scr_timer_create
scr_timer_tick
scr_state_machine_create
scr_state_machine_set
scr_input_axis
scr_debug_log
scr_assert_equal
scr_array_find_index
scr_lerp
scr_clamp01
```

Keep the initial kit small and heavily tested.

## 9. Milestone 3: GML Unit-Test Authoring and Execution

### Goal

Allow agents to define, inject, run, and collect GML unit tests quickly, ideally without manual GameMaker IDE interaction.

### Target Direction

The `test` command family should cover both repository-level TypeScript tests and GameMaker/GML test-case authoring, execution, result parsing, and reporting. The autonomous target is not just a test generator; it is a repeatable proof loop that lets agents create a gameplay change, generate or update relevant GML tests, run the most useful available validation path, and consume structured failures.

### Context

A separate GameMaker unit-test framework already exists, but it currently has to run inside the GameMaker IDE. GMLoop should provide an adapter around that framework so agents can author tests consistently and eventually run them automatically.

### CLI-First Test Workflow

Extend the existing `test` command family rather than creating a new tool family:

```text
gmloop test case create
gmloop test case update
gmloop test scaffold
gmloop test parse-results
gmloop test report
```

The existing MCP command-catalog integration should expose derived tools for these CLI commands. Do not implement a separate MCP-only test runner.

### Phase 1: IDE-Compatible Test Generation

The first version does not need perfect headless execution. It should reliably generate test resources that work with the existing framework.

Requirements:

- Create or update test scripts in the GameMaker project.
- Use the existing unit-test framework's conventions.
- Generate deterministic test names.
- Keep tests separate from production scripts where possible.
- Support test metadata and expected result descriptions.

Example command:

```text
gmloop test case create --path MyGame/MyGame.yyp --target scr_damage_enemy --name kills_enemy_at_zero_hp
```

### Phase 2: Runtime Test Execution

Use a special GameMaker test target or bootstrap room that runs tests and writes structured results.

Potential outputs:

```text
JSON result file
JUnit XML
plain-text summary
GameMaker log parser output
```

Prefer JUnit XML for CI integration because the repo already uses report-oriented test scripts.

### Phase 3: Transpiler-Based Pure Function Tests

Later, add a fast path for pure script tests by transpiling constrained GML to JavaScript and running in Node. This should not be the first implementation because it risks becoming an incomplete replacement for the GameMaker runtime.

### First Work Slice

1. Define a test manifest format.
2. Implement the existing `test case create` stub for simple function-style tests.
3. Implement the existing `test case update` stub.
4. Add fixture tests proving the generated GameMaker resources are stable.
5. Add result parsing for a sample GameMaker test result file.
6. Add CLI catalog / MCP catalog tests for the new commands.

## 10. Milestone 4: GameMaker Build, Run, and Log Loop

### Goal

Allow agents to prove that a generated or modified GameMaker game actually builds and, where possible, runs.

### Target Direction

The CLI should expose GMLoop-owned build/run/check surfaces where GMLoop adds value, such as normalized evidence, log parsing, hot-reload setup, graph context, or CI/test aggregation. Agents may also call `gm-cli` build/run/package commands directly through the official MCP surface. Fixture and mock providers should remain available for deterministic tests and environments without a local GameMaker toolchain.

### Possible Workspace

Only add a new workspace if needed:

```text
src/build
```

or:

```text
src/gamemaker-build
```

This workspace would expose GMLoop-specific build evidence and orchestration without hardcoding one build mechanism or mirroring the full `gm-cli` command surface.

### CLI Commands

Target command shape:

```text
gmloop game build --path MyGame/MyGame.yyp --target windows
gmloop game build --path MyGame/MyGame.yyp --target html5
gmloop game check-build --path MyGame/MyGame.yyp
gmloop game run --path MyGame/MyGame.yyp
gmloop game logs --path MyGame/MyGame.yyp
gmloop game smoke-test --path MyGame/MyGame.yyp
```

If the existing `runner` command is the better home, adapt the naming to fit the current CLI architecture rather than creating unnecessary overlap.

MCP should expose these commands through the normal CLI-derived catalog. Build providers should not be implemented directly in `@gmloop/mcp`.

### Provider Model

Potential providers:

```text
gm-cli
local-igor
github-action
stitch-action
html5-export
mock-fixture
```

The CLI and MCP surface should not expose provider-specific details unless necessary. Agents can call official `gm-cli` build/run/package tools directly when those are the right operation. A GMLoop build/run/check command is justified when it aggregates evidence, parses logs, coordinates hot reload, or chooses among providers for a GMLoop-owned workflow.

### External Provider Direction

`gm-cli` is the primary official companion for runtime acquisition plus compile/run/package workflows. Other providers, including open-source GitHub Actions such as Stitch, can be investigated for CI-specific build checks. Do not hide direct official-tool usage when it is the clearest operation; reserve GMLoop build commands for workflows that add GMLoop-owned evidence, validation, or orchestration.

### Required Behavior

- Capture build stdout/stderr/log files.
- Normalize common GameMaker build errors into structured diagnostics.
- Link errors back to resource names and file paths where possible.
- Emit machine-readable JSON output for CLI and MCP consumers.
- Support CI and local execution modes.
- Record provider, `gm-cli` version when applicable, target, runtime/toolchain, artifact paths, and whether execution was a real build or fixture/mock run.

### First Work Slice

1. Decide whether build/check/run belongs in the existing `runner` command family or a `game` command family.
2. Add a provider contract only for GMLoop-owned build evidence/orchestration, with `gm-cli` and mock/fixture implementations as candidate inputs.
3. Add log parsing for representative GameMaker build failures.
4. Add CI fixture tests around log parsing.
5. Add a real `gm-cli`-backed GMLoop workflow only once local/CI credentials, target platform, runtime constraints, and the added GMLoop value are known.
6. Verify MCP catalog exposure comes from the CLI command.

## 11. Milestone 5: Game Design and Game-Building Agent Skills

### Goal

Give agents durable, repo-local guidance for designing and building complete games rather than isolated code changes.

### Standalone Agent Pack

```text
src/agent-pack/                 # published as @gmloop/agent-pack
  skills/
    <skill-name>/
      SKILL.md
      scripts/       # optional
      references/    # optional
      assets/        # optional
  templates/
    project-agents.md # installed as project-root AGENTS.md when applicable
```

This is a conventional Agent Skills collection: every `skills/<name>/SKILL.md`
entry follows the open Agent Skills frontmatter and Markdown format. The design
document deliberately does not duplicate the collection's current names or
size; the directory contents are the inventory. The collection is separate
from GMLoop's repository-development skills under `.agents/skills`.
The standalone workspace publishes as `@gmloop/agent-pack`, so a game project
can install the raw resources with `npm install -D @gmloop/agent-pack` and inspect,
copy, or point standards-compatible tooling at them without installing the
GMLoop CLI, UI, MCP server, or other workspaces. The npm package is only the
distribution vehicle; its payload remains standard, inspectable Agent Skills
directories and portable guidance files, and installation itself does not
mutate project files.

The package has no independent executable. GMLoop retains one universal CLI,
and `gmloop agent-pack init --path <game-project>` is its only command-line
initialization surface. The Auto-Game UI invokes the same initializer through
the GMLoop host rather than maintaining a second implementation.

The agent-pack's `skills/` directory is the only packaged-collection source of
truth. Publication and initialization enumerate its skill directories; there is
no parallel manifest, hard-coded skill-name catalog, registration step, or
skill-specific loader. A maintainer adds a packaged Auto-Game skill by dropping
a standard skill directory there. `@gmloop/cli` depends on the agent-pack for
initialization and must not keep a second copy of its resources.

The collection is packaged as ordinary skill directories, not a GMLoop-specific
archive, manifest, registry, or runtime overlay. A skill may use the standard
optional `scripts/`, `references/`, and `assets/` directories. The official
`skills-ref` reference tool, or another established standards-compatible tool,
owns conformance validation. GMLoop uses `gray-matter` only to extract metadata
for the UI and must not grow a custom Agent Skills parser, schema, or validator.

The Auto-Game UI lists every skill discovered in the loaded game's collection
with its name, description, source path, file-availability status, and toggle.
All discovered skills are enabled by default, and only disabled names are stored
in `gmloop.json`. GMLoop adds no separate activation, trust, approval,
permission, installation, or execution layer; the active AI tool or CLI retains
those responsibilities through its normal Agent Skills behavior.

When the opened project has no initialized agent pack, the UI shows an
**Initialize Auto-Game Agent Pack** action. When its recorded installed version
is older than the bundled package version, the same surface shows an **Update
Auto-Game Agent Pack** action. Initialization materializes applicable resources,
including `.agents/skills/` and `AGENTS.md` guidance where needed. Repeat and
upgrade runs add missing files and refresh only files that still match their
previously installed pack content; project-created or project-modified files are
preserved and reported as conflicts. The UI refreshes the discovered catalog
after success and exposes server failures or conflicts with corrective guidance.

### Portability Contract

- Skills target the open Agent Skills format, not a particular LLM vendor or AI client.
- Each skill is independently useful and must not require another skill to run first.
- Instructions describe capabilities, project state, evidence, and outcomes rather than naming a specific MCP server, provider adapter, or client command.
- Provider- or tool-specific examples are omitted unless a portable capability description would be technically insufficient.
- Skills do not own permission, trust, activation, installation, or tool-discovery policy.
- Changes to available commands or MCP tools should not require rewriting stable game-design or GameMaker workflow guidance.

### Skill Content Contract

Each packaged skill owns its own trigger description, workflow, domain guidance,
guardrails, verification expectations, and completion/reporting contract in its
`SKILL.md`. Collection-level documentation must not enumerate skill names,
duplicate skill-specific instructions, or state a collection size. This keeps a
skill addition, removal, rename, or rewrite local to its standard directory.

Skills should remain concise, independently useful, and focused on durable
GameMaker or game-development capabilities. They should favor observable
outcomes, evidence, deterministic verification, accessibility, bounded scope,
and structured project mutation without assuming a particular client or tool.

### Current Implementation

The independently publishable `@gmloop/agent-pack` workspace owns only the raw
skill collection, project-guidance template, and package version. The main
GMLoop CLI resolves those resources and owns version status, provenance, and
conflict-safe materialization through `gmloop agent-pack init`; the package
itself exposes no CLI or runtime API. The Auto-Game UI invokes that same CLI-host
implementation. Auto-Game discovers skills only from the loaded GameMaker
project's `.agents/skills` directory;
GMLoop's source-level `.agents/skills` directory is exclusively for agents
developing GMLoop itself. Auto-Game never reads or modifies it, and those
internal skills never enter the game-building catalog.

The current collection conforms to the content and portability contracts above.
Its actual inventory is always obtained from the directory rather than repeated
in documentation or source code.

## 12. Agent Coordination Boundary

GMLoop is a first-class GameMaker companion surface for AI agents, not a
general multi-agent coordinator.

GMLoop owns the GameMaker-specific tooling layer: project understanding,
semantic graph context, parser/lint/refactor/format/fix workflows, live-reload
status, MCP tool exposure, agent-pack installation, skill discovery, project
guidance, and structured evidence from those operations.

External agent managers own orchestration: model selection, agent scheduling,
permissions, approvals, retries, memory, budgets, queues, task routing, task
claiming, and long-running workflow state. GMLoop must not add an internal task
graph, agent work queue, scheduler, subagent runtime, or durable agent log as a
parallel orchestration system.

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

### UI Boundary

The Auto-Game or Agents companion dashboard may expose installed skills, skill
enablement, packaged guidance previews, MCP/tool readiness, graph/search
context, validation results, fix/refactor actions, live-reload status, and task
evidence supplied by a coordinator. It may provide lightweight affordances such
as copying prompts, opening an external agent, or launching a configured
companion command.

The UI must not become a multi-agent DAG editor, model router, prompt debugger
for arbitrary frameworks, workflow engine, approval/permission system, memory
store, or background task queue.

### Optional Integration Contract

Integrations with agent frameworks are optional adapters over stable local
contracts, not core dependencies. An adapter may configure MCP access, locate
project guidance and enabled skills, launch an external coordinator, or pass
structured GMLoop results back to it. It must not move coordinator-specific
models, lifecycle state, or policy into GMLoop's core workspaces.

The core product remains vendor-neutral and coordinator-neutral. GMLoop makes
agents better at working on GameMaker projects without inheriting the
complexity, security risk, and product scope of a full agent platform.

## 13. End-to-End Target Workflow

The long-term autonomous creation loop should look like this:

```text
1. User requests a game concept or feature through an external agent coordinator.
2. The coordinator creates or updates game-design.md, splits work, and selects the next task.
3. The active agent imports helpers/templates from gml-kit when applicable.
4. The agent mutates GameMaker resources through CLI/MCP-backed structured commands.
5. The agent formats and lints GML.
6. The agent generates or updates tests.
7. The agent hot-reloads into the HTML5 target where possible, then builds/runs/tests the GameMaker project through the best available provider, including `gm-cli` where available.
8. The agent inspects logs, structured diagnostics, and task evidence from GMLoop.
9. The agent fixes failures.
10. The external coordinator records workflow state and decides whether to commit, open a PR, retry, request approval, or schedule more work.
```

## 14. Recommended Implementation Order

### Phase 1: Complete Existing GameMaker Mutation Surfaces

Deliver:

```text
object event editing
room instance editing
room layer editing
room camera editing
test case create/update
gm-cli ResourceTool provider adapter where useful
fixture tests
structured JSON output improvements
CLI catalog tests
MCP catalog exposure tests
```

### Phase 2: Minimal Helper Library

Deliver:

```text
src/gml-kit
helper manifest format
5 to 10 tiny helpers
kit list/search/import commands
fixture import tests
CLI/MCP catalog coverage
```

### Phase 3: GameMaker Unit-Test Adapter

Deliver:

```text
test manifest format
test case create/update implementation
sample generated tests
result parser
JUnit output
CLI/MCP catalog coverage
```

### Phase 4: Build / Runner Facade

Deliver:

```text
runner/build command audit
provider contract
gm-cli provider target
mock provider
log parser
check-build command
real provider investigation and fixture fallback
CLI/MCP catalog coverage
```

### Phase 5: Agent Skills and Optional Coordinator Adapters

Deliver:

```text
game-design skill
gamemaker-resources skill
stable task-evidence result contracts
optional coordinator launch/configuration adapters
adapter contract tests
```

## 15. Highest-Leverage Immediate PRs

1. **Implement one high-value mutation command family.**
   Best first target: `object event update`, because agents need a reliable way to put behavior into objects after creating or selecting a resource.

2. **Clarify or add one companion ResourceTool workflow.**
   Start with one mutation or inspection class and decide whether agents should use the official ResourceTool MCP directly or whether GMLoop adds graph-aware validation, dry-run planning, hot-reload coordination, or task evidence worth exposing as a separate CLI-derived MCP tool.

3. **Improve structured JSON output for resource mutations.**
   Agent/MCP usage benefits from consistent JSON payloads, deterministic ordering, dry-run summaries, and actionable error codes.

4. **Add MCP catalog tests for autonomous-game commands.**
   Verify the MCP server exposes CLI-backed tools automatically and keeps names, schemas, write behavior, and result payloads stable.

5. **Implement `test case create/update`.**
   This connects the existing `test` command family to real test authoring.

6. **Add a minimal `gml-kit` helper library.**
   Start with a small manifest-driven library rather than a large prefab system.

7. **Audit and extend the runner/build surface alongside `gm-cli`.**
   Start by separating direct official `gm-cli` MCP usage from GMLoop-owned build evidence, fixture providers, log parsing, and hot-reload coordination.

8. **Add game-design and GameMaker-resource agent skills.**
   Improve agent behavior before large automation is attempted.

9. **Define an optional coordinator adapter contract.**
   Support lightweight configuration, launch, and result handoff without importing framework-specific orchestration state or policy into GMLoop.

## 16. Open Questions

1. Which `gm-cli` versions should GMLoop support or require for the first official-provider integration?
2. Which GameMaker targets, runtimes, and toolchains should the first `gm-cli` build/run provider support?
3. Can the open-source Stitch GitHub Action reliably build the target project types in CI, and should it remain a secondary provider behind `gm-cli`?
4. Which ResourceTool operations should agents call directly through `gm-cli` MCP, and which deserve a separate GMLoop companion command because they add graph/refactor/hot-reload context?
5. Should manual lookup stay entirely on `gm-cli` MCP, or should GMLoop add read-only companion context that links manual results to symbols, diagnostics, or graph nodes?
6. Should the reusable GML kit be shipped as source resources, package artifacts, or project templates?
7. How should generated projects distinguish production resources from test-only resources?
8. What is the minimum viable headless test runner for the existing unit-test framework?
9. Should generated games keep `.gmloop` metadata in the project root, or should metadata live outside the GameMaker project tree?
10. How much of the runtime/playtest loop can be automated through HTML5 export, `gm-cli run`, and browser automation?
11. Which stable local contracts are needed for optional Codex, Claude Code, Qwen, OpenHands, AutoGen, CrewAI, or LangGraph adapters?
12. Is the current CLI metadata rich enough for all future autonomous-game MCP schemas, or does the CLI catalog need additional option/argument annotations?
13. Should MCP expose any additional read-only GameMaker project resources beyond CLI tools, such as `gm://project/overview` or `gm://resource/<name>`?
14. Should human-readable mutation commands support `--json` consistently before agents rely on them heavily?

## 17. Summary

The next stage for GMLoop is to become a first-class GameMaker companion surface for externally coordinated agents, not only a set of GML code tools. The core unlocks are:

```text
completion of existing resource/object/room/test command surfaces
CLI-backed agent tool commands
existing MCP exposure through the CLI catalog
direct companion use of official `gm-cli` MCP for project, ResourceTool, build/run/package, manual, and publish workflows
reusable GML helper systems
unit-test generation and execution
GameMaker build/run validation
game-design agent skills
stable task-evidence contracts
optional coordinator adapters
```

The first priority should be completing high-level GameMaker mutation, validation, and companion-tool paths that let agents create resources, edit object events, place room instances, author tests, and prove builds without raw project-file edits. GMLoop MCP should surface GMLoop-owned capabilities through its CLI-derived tool catalog. `gm-cli` MCP should remain a peer surface for official GameMaker lifecycle behavior, while GMLoop continues to own semantic analysis, hot reload, and structured GameMaker automation contracts. External coordinators retain workflow orchestration.
