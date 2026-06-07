# Autonomous GameMaker Creator Plan

GMLoop has the lower-level ingredients for agent-assisted GameMaker development: parser, formatter, lint rules, refactors, semantic indexing, transpilation, runtime hot reload, a CLI, UI surfaces, fixture infrastructure, and an MCP workspace. The next step is to turn those tools into a higher-level autonomous game creation system that can design, modify, test, build, run, and iteratively improve complete GameMaker projects.

The target is not merely an agent that writes `.gml` files. The target is a closed-loop GameMaker development platform where agents can safely mutate real GameMaker resources, reuse known-good gameplay systems, run validation, split work into tasks, and continue work through scheduled or PR-driven automation. The primary runtime target is GameMaker HTML5, with GMLoop hot-reload functionality as the default iteration loop so agents can quickly change gameplay code/resources, observe results, inspect diagnostics, and keep developing without slow full rebuild cycles whenever hot reload can provide a valid proof step.

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
- GitHub Actions agent workflows for PR-comment-driven agent execution.
- [YoYoGames/gm-cli](https://github.com/YoYoGames/gm-cli) as the official GameMaker command-line tool for project creation, ResourceTool edits, compile/run/package workflows, manual lookup, GX.Games publishing, and its own ResourceTool MCP mode.

The target state is a reusable game-creation operating system with rich project mutation APIs, build/run/test loops, game-design skills, task orchestration, helper libraries, scheduled autonomous improvement flows, and clean integration with the official GameMaker CLI ecosystem.

## 2. MCP Role and Architectural Boundary

`@gmloop/mcp` is already the agent-facing transport and exposure layer. It should not be treated as missing infrastructure that needs to be reinvented.

The current and target layering is:

```text
GameMaker domain behavior and project/resource mutation logic
  -> CLI commands and structured output
    -> MCP tool exposure derived from the CLI catalog
      -> agent clients and scheduled workflows
```

This means new autonomous-game capabilities should generally extend existing domain behavior and CLI commands first. Once the CLI command is in the catalog, the existing MCP server should expose it to agents without duplicating command behavior inside `@gmloop/mcp`.

Important nuance: MCP can and should expose high-level tools such as "add a resource" or "create a room". In that sense, agents using MCP do not need to know how `.yyp` or `.yy` files are edited. The lower-level `.yyp` / `.yy` mutation is already abstracted by the CLI/refactor/resource command layer for supported operations.

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

- project and resource creation, deletion, duplication, rename, movement, and validation;
- object, event, room, layer, camera, sprite, sound, shader, script, path, timeline, font, sequence, tile set, and included-file operations where they are meaningful for autonomous creation;
- high-level GameMaker operations that hide `.yyp` and `.yy` structure from agents while preserving exact metadata correctness;
- graph-backed project inspection and context retrieval for planning edits;
- structured dry-run and write modes for mutations;
- deterministic JSON summaries for CLI users and MCP consumers;
- HTML5-first playtest and runtime inspection workflows that use GMLoop hot reload as the fast path for iterative development;
- validation flows that format, lint, test, build, run, inspect logs, and iterate from failures;
- integration with `gm-cli` where the official tool is the right owner for project initialization, ResourceTool operations, runtime/toolchain management, compile/run/package, manual search, and publishing.

## 4. YoYoGames `gm-cli` Integration Target

`gm-cli` is an official command-line interface for editing, compiling, packaging, and running GameMaker projects. It should be treated as a first-class integration point, not as a competitor to GMLoop.

Target relationship:

- GMLoop owns GML analysis, formatting, linting, semantic graph/context, refactors, hot reload, workflow orchestration, and the agent-facing command catalog.
- `gm-cli` owns official GameMaker project initialization, runtime/toolchain acquisition, compile/run/package behavior, ResourceTool capabilities, manual lookup, and publish flows where those official paths are available and reliable.
- GMLoop may wrap or delegate to `gm-cli` behind typed provider interfaces when doing so gives agents a more correct, complete, or future-proof GameMaker operation.
- GMLoop should normalize `gm-cli` output into stable structured results with source paths, resource names, diagnostics, command provenance, and actionable failure reasons.
- GMLoop should expose `gm-cli`-backed operations through its normal CLI command catalog so MCP tools remain derived from GMLoop CLI metadata.
- GMLoop should not reimplement official `gm-cli` behavior purely to avoid invoking it. Reimplementation is justified only when GMLoop needs tighter semantic integration, deterministic fixture-mode tests, hot-reload-specific behavior, or capabilities that `gm-cli` does not provide.
- `gm-cli resourcetool mcp` can be used as an interoperability target or fallback for direct ResourceTool access, but GMLoop's MCP server should remain catalog-derived from GMLoop CLI commands rather than becoming a proxy full of MCP-only business logic.
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
   Before adding a new workspace or API, check whether the capability belongs in the existing `resource`, `object`, `room`, `project`, `runner`, `test`, `refactor`, `semantic`, or provider-integration paths. Prefer delegating official GameMaker lifecycle work to `gm-cli` when it is the better owner.

3. **CLI is the source of truth for agent tools.**
   New autonomous-game behavior should be added as CLI commands with structured output. MCP should expose those commands by deriving tools from the CLI command catalog, not by defining parallel MCP-only tools.

4. **MCP is already the right exposure layer.**
   The plan should extend what MCP can expose by filling real capabilities underneath it, not by inventing a second agent API.

5. **Validation must close the loop.**
   The system must be able to format, lint, test, build, run, inspect logs, and iterate from failures. Autonomous game creation is not reliable without an automated proof step.

6. **Official tools should be integrated, not shadowed.**
   When `gm-cli` provides a stable project, ResourceTool, build, run, package, manual, or publish capability, GMLoop should wrap it behind typed provider contracts and structured outputs instead of creating a parallel version of the same official workflow.

7. **Reusable building blocks beat repeated invention.**
   Agents should compose known-good helpers, systems, templates, and prefabs instead of inventing new state machines, input systems, cameras, and UI primitives every time.

8. **Task graphs should coordinate agents.**
   Scheduled agents and subagents need a machine-readable plan, not just freeform prompts. Work should be split, claimed, blocked, completed, and reviewed through explicit task metadata.

9. **Game design context is as important as code context.**
   Agents need skills and prompts for core loops, player agency, feedback, juice, scope, loss/win criteria, progression, balancing, and vertical-slice planning.

## 6. CLI/MCP Command Contract

The CLI/MCP command surface is part of the autonomous creation target state. It should remain stable, discoverable, and machine-readable enough for agents to plan and execute work without parsing human prose.

### Decisions

| Decision | Target |
| --- | --- |
| CLI naming | Use domain-noun top-level commands with short verb subcommands: `resource add`, `room list`, `runner logs`, `symbol inspect`. |
| MCP naming | Derive tool names from CLI leaf paths with a `gmloop_` prefix and underscores, such as `gmloop_resource_add`, `gmloop_graph_search`, and `gmloop_runner_logs`. |
| CLI source of truth | The `@gmloop/cli` command catalog defines the canonical public agent-control surface. |
| MCP architecture | `@gmloop/mcp` remains a thin wrapper over the CLI catalog. It should not define standalone command tools or duplicate command business logic. |
| Runtime target | Design the agent surface for GameMaker HTML5, GMLoop hot reload, and official GameMaker toolchain integration rather than generic desktop IDE automation. |
| Browser automation boundary | Do not recreate browser automation already handled by Playwright/browser MCP servers, such as screenshots, keyboard input, mouse input, browser navigation, DOM inspection, or viewport emulation. |
| Standalone vs options | Prefer one command per domain action and move getter/setter expansion into `inspect`, `update`, `validate`, `query`, `state`, `logs`, `capture`, and `report` subcommands with explicit options. |
| Graph commands | Keep graph-wide commands under `graph`; place symbol-centric queries under a separate `symbol` suite for AI ergonomics. |
| Symbol inspection | Use `symbol inspect` as the unified symbol entrypoint instead of builtin-only special-case commands. |
| Legacy prefixes | Do not use `gml_` prefixes. Keep CLI command names unprefixed and reserve `gmloop_` for MCP tool names. |

### Contract Rules

| Rule | Requirement |
| --- | --- |
| Source of truth | If a capability should be exposed to AI agents, it must first exist as a real CLI command/subcommand. |
| MCP derivation | Every MCP command tool must be generated from the CLI command catalog and mirror the CLI leaf command name, description, arguments, and options. |
| No standalone MCP tools | Do not add handwritten, static, predefined, or MCP-only command tools. |
| No parallel command surfaces | Do not create capabilities that exist only in MCP and not in the CLI. |
| DRY schema ownership | Argument parsing, option names, defaults, validation, and help text should be owned once by the CLI and reused by MCP generation. |
| Change workflow | To add, remove, or rename an MCP command tool, change the CLI command definition. |
| Resources exception | MCP resources may still exist for read-only graph/context/project views, but command-like behavior must come from CLI-derived tools. |
| Browser-tool exception | Browser automation primitives should be delegated to Playwright/browser MCP tooling rather than reimplemented in `@gmloop/mcp`. |
| External tool strategy | When `gm-cli`, Stitch, or another proven package owns a GameMaker project, launcher, ResourceTool, or build concern well, wrap it cleanly behind GMLoop CLI/provider contracts rather than reimplementing it. |

### External Tooling Strategy

| Source | Target use |
| --- | --- |
| [YoYoGames/gm-cli](https://github.com/YoYoGames/gm-cli) | Preferred official integration point for project creation, ResourceTool edits, compile/run/package, runtime/toolchain handling, manual lookup, MCP ResourceTool interoperability, and publishing. |
| [bscotch/stitch](https://github.com/bscotch/stitch) | Reference for GameMaker project automation patterns and possible reusable implementation ideas where they fit GMLoop boundaries. |
| [bscotch/stitch `packages/yy`](https://github.com/bscotch/stitch/tree/develop/packages/yy) | Reference or dependency candidate for `.yy`/`.yyp` schema handling when it avoids duplicating GameMaker metadata logic. |
| [bscotch/stitch `packages/launcher`](https://github.com/bscotch/stitch/tree/develop/packages/launcher) | Reference or dependency candidate for launch/runtime/build orchestration where it fits the HTML5/hot-reload workflow. |
| GameMaker manual command-line build docs | Official reference for GameMaker build invocation behavior and supported flags. |
| YoYo Games build automation guidance | Reference for supported GameMaker build automation and CI patterns. |
| Adjacent GameMaker MCP servers | Comparison points for scope decisions, not the source of truth for GMLoop's MCP design. |

### Target CLI Taxonomy

| Top-level command | Purpose | Primary backing workspace(s) |
| --- | --- | --- |
| `graph` | Build, query, diagnose, and visualize the semantic graph index. | `@gmloop/semantic`, `@gmloop/ui` |
| `symbol` | Inspect symbols, context, usages, and relationships. | `@gmloop/semantic` |
| `validate` | Validate GML files, projects, rooms, and resources. | `@gmloop/parser`, `@gmloop/semantic`, `@gmloop/refactor` |
| `project` | Create, initialize, inspect, validate, clean, and prepare projects. | `@gmloop/cli`, `@gmloop/refactor`, `gm-cli` providers |
| `resource` | Inspect and mutate project resource inventory and metadata. | `@gmloop/semantic`, `@gmloop/refactor`, `gm-cli` ResourceTool providers |
| `room` | Inspect, validate, preview, and mutate rooms, instances, layers, and cameras. | `@gmloop/semantic`, `@gmloop/refactor`, `@gmloop/ui` |
| `object` | Inspect, validate, and mutate object properties and events. | `@gmloop/semantic`, `@gmloop/refactor` |
| `runner` or `game` | Build, run, package, check, log, and manage GameMaker process lifecycle. | `@gmloop/cli`, `@gmloop/runtime-wrapper`, `gm-cli` providers |
| `runtime` | Inspect and mutate live in-game state through the runtime wrapper. | `@gmloop/runtime-wrapper`, `@gmloop/transpiler`, `@gmloop/cli` |
| `profile` | Capture runtime performance snapshots and reports. | `@gmloop/runtime-wrapper`, `@gmloop/cli` |
| `test` | Discover, author, run, parse, and report tests. | `@gmloop/cli`, `@gmloop/runtime-wrapper` |
| `replay` | Record, run, compare, and assert deterministic sessions. | `@gmloop/runtime-wrapper`, `@gmloop/cli` |
| `kit` | List, inspect, and import reusable GML helpers/templates. | `@gmloop/cli`, future `@gmloop/gml-kit`, `@gmloop/refactor` |
| `task` | Manage autonomous-game task graph state. | `@gmloop/cli`, future task-graph domain layer |
| `ui` | Validate, preview, and scaffold GMLoop UI-facing artifacts. | `@gmloop/ui`, `@gmloop/refactor`, `@gmloop/cli` |

### Canonical Agent Command Surface

| Capability | Target CLI commands | Target MCP names | Primary owner |
| --- | --- | --- | --- |
| Graph index and discovery | `graph index`, `graph search`, `graph doctor`, `graph visualize` | `gmloop_graph_index`, `gmloop_graph_search`, `gmloop_graph_doctor`, `gmloop_graph_visualize` | `@gmloop/semantic`, `@gmloop/ui` |
| Symbol inspection and relationships | `symbol inspect`, `symbol context`, `symbol neighbors`, `symbol usages` | `gmloop_symbol_inspect`, `gmloop_symbol_context`, `gmloop_symbol_neighbors`, `gmloop_symbol_usages` | `@gmloop/semantic` |
| Validation | `validate file`, `validate project`, `validate room`, `validate resource` | `gmloop_validate_file`, `gmloop_validate_project`, `gmloop_validate_room`, `gmloop_validate_resource` | parser/semantic/refactor |
| Project lifecycle | `project create`, `project init`, `project inspect`, `project validate`, `project cache clean` | `gmloop_project_create`, `gmloop_project_init`, `gmloop_project_inspect`, `gmloop_project_validate`, `gmloop_project_cache_clean` | CLI/refactor/`gm-cli` providers |
| Resource inventory | `resource list`, `resource find`, `resource inspect`, `resource deps`, `resource dependents`, `resource audit` | `gmloop_resource_list`, `gmloop_resource_find`, `gmloop_resource_inspect`, `gmloop_resource_deps`, `gmloop_resource_dependents`, `gmloop_resource_audit` | semantic |
| Resource mutations | `resource add`, `resource remove`, `resource rename`, `resource duplicate`, `resource move` | `gmloop_resource_add`, `gmloop_resource_remove`, `gmloop_resource_rename`, `gmloop_resource_duplicate`, `gmloop_resource_move` | refactor/`gm-cli` ResourceTool providers |
| Room inspection and analysis | `room list`, `room inspect`, `room query`, `room validate`, `room preview`, `room summary` | `gmloop_room_list`, `gmloop_room_inspect`, `gmloop_room_query`, `gmloop_room_validate`, `gmloop_room_preview`, `gmloop_room_summary` | semantic/ui |
| Room mutations | `room create`, `room duplicate`, `room rename`, `room delete`, `room update`, `room repair` | `gmloop_room_create`, `gmloop_room_duplicate`, `gmloop_room_rename`, `gmloop_room_delete`, `gmloop_room_update`, `gmloop_room_repair` | refactor |
| Room instances | `room instance add`, `room instance update`, `room instance delete` | `gmloop_room_instance_add`, `gmloop_room_instance_update`, `gmloop_room_instance_delete` | refactor/semantic |
| Room layers and cameras | `room layer list/inspect/create/update/delete/reorder/move-resource`, `room camera list/inspect/update/frame` | Derived from the CLI leaf path, for example `gmloop_room_layer_create` and `gmloop_room_camera_update` | refactor/semantic |
| Object inspection and mutation | `object list`, `object inspect`, `object update`, `object validate`, `object event list/inspect/add/update/delete` | Derived from the CLI leaf path, for example `gmloop_object_event_update` | semantic/refactor |
| Build, run, package, and logs | `game build`, `game check-build`, `game run`, `game package`, `game logs`, or equivalent `runner` leaves | Derived from the CLI leaf path, for example `gmloop_game_build` or `gmloop_runner_logs` | CLI/runtime-wrapper/`gm-cli` providers |
| Live runtime inspection and mutation | `runtime instances`, `runtime inspect`, `runtime get`, `runtime set`, `runtime call`, `runtime watch`, `runtime state`, `runtime logs` | Derived from the CLI leaf path, for example `gmloop_runtime_call` | runtime-wrapper/transpiler/CLI |
| Profiling | `profile start`, `profile stop`, `profile snapshot`, `profile compare`, `profile report` | `gmloop_profile_start`, `gmloop_profile_stop`, `gmloop_profile_snapshot`, `gmloop_profile_compare`, `gmloop_profile_report` | runtime-wrapper/CLI |
| Tests | `test list`, `test run`, `test results`, `test case create`, `test case update`, `test parse-results`, `test report` | Derived from the CLI leaf path, for example `gmloop_test_case_create` | CLI/runtime-wrapper |
| Replays | `replay record`, `replay run`, `replay compare`, `replay assert` | `gmloop_replay_record`, `gmloop_replay_run`, `gmloop_replay_compare`, `gmloop_replay_assert` | runtime-wrapper/CLI |
| Helper kit | `kit list`, `kit search`, `kit inspect`, `kit import`, `kit dependencies` | Derived from the CLI leaf path, for example `gmloop_kit_import` | CLI/gml-kit/refactor |
| Task graph | `task init`, `task list`, `task next`, `task claim`, `task update`, `task complete`, `task block`, `task summary` | Derived from the CLI leaf path, for example `gmloop_task_next` | CLI/task-graph layer |
| UI validation and scaffolding | `ui inspect`, `ui validate`, `ui preview`, `ui scaffold` | `gmloop_ui_inspect`, `gmloop_ui_validate`, `gmloop_ui_preview`, `gmloop_ui_scaffold` | UI/refactor/CLI |

### Priority Order for Agent-Facing Work

| Priority | Recommended focus |
| --- | --- |
| High | `graph search`, `symbol inspect`, `validate file/project`, `project create/init/validate`, `resource list/find/inspect/add/remove/rename`, `room list/inspect/update/instance add`, `object inspect/update/event update`, build/check/log commands backed by `gm-cli`, and runtime get/set/call/watch where hot reload requires it. |
| Medium | `resource deps/dependents/audit`, `room preview/query/camera/layer`, `profile`, `test`, `replay`, `kit`, and task graph commands. |
| Low | Cache cleanup, IDE/open convenience flows, and commands that only wrap editor convenience rather than enabling autonomous agent work. |

### Explicitly Out of Scope for `@gmloop/mcp`

| Capability class | Reason |
| --- | --- |
| Browser screenshots and page/video capture | Already handled by Playwright/browser MCP tools. |
| Browser keyboard, mouse, and gamepad interaction | Already handled by Playwright/browser MCP tools. |
| Browser navigation, DOM inspection, and viewport/device emulation | Already handled by Playwright/browser MCP tools. |
| Generic browser-state observation | Already handled by Playwright/browser MCP tools. |

## 7. Milestone 1: Complete Resource-Aware GameMaker Project Mutation

### Goal

Allow agents to safely inspect and mutate real GameMaker projects through the existing CLI/MCP abstraction rather than ad-hoc file edits.

### Target Direction

Resource-aware commands should let agents modify a GameMaker project through high-level operations while the owning implementation preserves `.yyp`, `.yy`, folder, and resource metadata invariants. GMLoop should use its own semantic/refactor APIs where deep project context is needed, and should integrate with `gm-cli resourcetool` where the official ResourceTool is the stronger or broader project-editing backend.

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

When a command delegates to `gm-cli resourcetool`, the GMLoop command should still own path resolution, dry-run/write semantics, output normalization, test fixtures, and MCP catalog metadata. Agents should not have to choose between "GMLoop project mutation" and "official ResourceTool mutation"; the GMLoop CLI should present one coherent automation contract.

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
- Reuse existing `@gmloop/refactor` resource mutation paths where applicable.
- Delegate to `gm-cli resourcetool` where official ResourceTool coverage is more complete or safer.
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

The CLI should expose a high-level build/run/check surface that can use multiple providers without forcing agents to learn provider-specific details. `gm-cli` should be the preferred real local provider for official GameMaker project initialization, runtime/toolchain management, compile, run, and package workflows. Fixture and mock providers should remain available for deterministic tests and environments without a local GameMaker toolchain.

### Possible Workspace

Only add a new workspace if needed:

```text
src/build
```

or:

```text
src/gamemaker-build
```

This workspace would expose a provider-backed build facade rather than hardcoding one build mechanism.

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

The CLI and MCP surface should not expose provider-specific details unless necessary. Agents should call the high-level build/run/check command; GMLoop can decide whether that means invoking `gm-cli run`, `gm-cli compile`, `gm-cli package`, a lower-level local toolchain, an existing GitHub Action, a Stitch-backed action, an HTML5 hot-reload export, or a fixture-mode build.

### External Provider Direction

`gm-cli` is the primary external provider candidate because it is the official GameMaker CLI and covers runtime acquisition plus compile/run/package workflows. Other providers, including open-source GitHub Actions such as Stitch, can be investigated for CI-specific build checks. Do not make agent prompts depend directly on any provider. Wrap each provider behind the GMLoop build facade.

### Required Behavior

- Capture build stdout/stderr/log files.
- Normalize common GameMaker build errors into structured diagnostics.
- Link errors back to resource names and file paths where possible.
- Emit machine-readable JSON output for CLI and MCP consumers.
- Support CI and local execution modes.
- Record provider, `gm-cli` version when applicable, target, runtime/toolchain, artifact paths, and whether execution was a real build or fixture/mock run.

### First Work Slice

1. Decide whether build/check/run belongs in the existing `runner` command family or a `game` command family.
2. Add a provider contract with `gm-cli` and mock/fixture implementations as the initial target shape.
3. Add log parsing for representative GameMaker build failures.
4. Add CI fixture tests around log parsing.
5. Add a real `gm-cli` provider once local/CI credentials, target platform, and runtime constraints are known.
6. Verify MCP catalog exposure comes from the CLI command.

## 11. Milestone 5: Game Design and Game-Building Agent Skills

### Goal

Give agents durable, repo-local guidance for designing and building complete games rather than isolated code changes.

### Proposed Skills

```text
.agents/skills/game-design/SKILL.md
.agents/skills/gml-gameplay/SKILL.md
.agents/skills/gamemaker-resources/SKILL.md
.agents/skills/gml-tests/SKILL.md
.agents/skills/game-debugging/SKILL.md
.agents/skills/game-polish-and-juice/SKILL.md
.agents/skills/prototype-to-vertical-slice/SKILL.md
```

### `game-design` Skill Topics

The game-design skill should force agents to define or preserve:

```text
core fantasy
core loop
player verbs
moment-to-moment decisions
win condition
loss condition
progression
feedback and juice
risk/reward
resource economy
content scope
testability
minimum playable slice
accessibility
balancing assumptions
simplicity of controls
bloat reduction
simplifying the core loop
juice and feedback opportunities
```

### `gml-gameplay` Skill Topics

```text
GameMaker object/event patterns
Create/Step/Draw responsibilities
script organization
input handling
state machines
collision conventions
room setup
save/load patterns
performance constraints
GML style conventions
```

### `gml-tests` Skill Topics

```text
how to structure unit tests
how to isolate pure scripts
when to use runtime smoke tests
how to write deterministic tests
how to avoid brittle log wording assertions
how to report test results
```

### First Work Slice

Add `game-design/SKILL.md` and `gamemaker-resources/SKILL.md` first. Those two skills should immediately improve agent behavior for project creation and resource edits.

## 12. Milestone 6: Task Graph and Agent Work Queue

### Goal

Give scheduled agents and subagents a machine-readable TODO list so they can coordinate without duplicating or thrashing work.

### Proposed Files

For generated game projects:

```text
.gmloop/tasks.json
.gmloop/plan.md
.gmloop/game-design.md
.gmloop/agent-log.jsonl
```

For the GMLoop repo itself, equivalent files could live under:

```text
docs/autonomous-game-creator-plan.md
.agents/tasks.json
```

### Task Schema

Example:

```json
{
  "id": "gameplay.player_movement.v1",
  "title": "Implement basic player movement",
  "status": "ready",
  "owner": null,
  "dependsOn": ["project.bootstrap"],
  "acceptance": [
    "Player object exists",
    "Arrow/WASD movement works",
    "Movement speed is configurable",
    "Unit tests or smoke test exist"
  ],
  "files": [
    "objects/obj_player",
    "scripts/scr_player_input"
  ]
}
```

### CLI-First Commands

```text
gmloop tasks init
gmloop tasks list
gmloop tasks next
gmloop tasks claim
gmloop tasks split
gmloop tasks complete
gmloop tasks block
gmloop tasks log
```

Derived MCP tools should come from these commands:

```text
gmloop_tasks_list
gmloop_tasks_next
gmloop_tasks_claim
gmloop_tasks_complete
gmloop_tasks_block
gmloop_tasks_split
```

Task graph transition logic should not live inside `@gmloop/mcp`.

### Required Behavior

- Dependency-aware next-task selection.
- Status transitions with validation.
- Acceptance criteria on every implementation task.
- Machine-readable agent logs.
- Optional links to PRs, commits, files, build runs, and test results.

### First Work Slice

1. Define the task schema.
2. Add `gmloop tasks init/list/next/complete`.
3. Store files as JSON with stable formatting.
4. Add fixture tests.
5. Add CLI catalog / MCP catalog tests proving the commands are exposed.

## 13. Milestone 7: Scheduled Agentic Game Improvement Flow

### Goal

Extend the existing GitHub Actions agent workflow pattern from repo-maintenance tasks to game-creation tasks.

### Proposed Workflows

```text
.github/workflows/agent-game-plan.yml
.github/workflows/agent-game-implement.yml
.github/workflows/agent-game-test.yml
.github/workflows/agent-game-polish.yml
.github/workflows/agent-game-review.yml
```

### Workflow Types

```text
daily prototype improvement
nightly build/test repair
weekly content expansion
scheduled polish pass
scheduled bug triage
scheduled helper-library expansion
```

### Relationship to MCP

Scheduled workflows may invoke CLI commands directly or through MCP-enabled agent clients. The workflow should not bypass the same capability boundaries: domain behavior remains below the CLI surface, CLI commands remain the canonical tool surface, and MCP remains an optional agent transport over those commands.

### Required Behavior

- Pull the next task from `.gmloop/tasks.json`.
- Run the appropriate agent role prompt.
- Require a repository diff or explicit blocked status.
- Run relevant validation.
- Commit or open a PR.
- Write a machine-readable agent summary.
- Update the task graph.

### First Work Slice

Create one scheduled workflow that runs in dry-run or issue-creation mode only:

```text
agent-game-plan.yml
```

It should inspect the task graph and propose the next implementation task without mutating game resources yet.

## 14. Milestone 8: Subagent Orchestration

### Goal

Allow larger game-development goals to be split across specialized agents.

### Roles

```text
designer
planner
implementer
tester
debugger
refactorer
polisher
reviewer
asset-integrator
```

### Orchestration Loop

```text
planner splits milestone into tasks
implementer claims one ready task
tester adds or updates tests
debugger fixes failing validation
reviewer checks design coherence and code quality
polisher improves feel, feedback, and UX
planner updates the task graph
```

### Relationship to MCP

Subagents should use the MCP server as the agent tool surface when available, but they should still be exercising CLI-backed capabilities. A subagent should not need bespoke MCP-only behavior to create resources, import helpers, run tests, or update tasks.

### Required Constraints

- Each subagent gets one narrow task.
- Each subagent must write a machine-readable summary.
- Each subagent must cite changed files and validation results.
- Agents should not silently rewrite unrelated systems.
- Parent orchestration should prevent multiple agents from claiming the same task.

### First Work Slice

Add role prompt files and a sequential parent workflow before attempting parallel agents.

```text
.agents/roles/game-planner.md
.agents/roles/game-implementer.md
.agents/roles/game-tester.md
.agents/roles/game-reviewer.md
```

## 15. End-to-End Target Workflow

The long-term autonomous creation loop should look like this:

```text
1. User requests a game concept or feature.
2. Agent creates or updates game-design.md.
3. Agent splits the design into tasks.
4. Agent selects the next ready task.
5. Agent imports helpers/templates from gml-kit when applicable.
6. Agent mutates GameMaker resources through existing CLI/MCP-backed structured commands.
7. Agent formats and lints GML.
8. Agent generates or updates tests.
9. Agent hot-reloads into the HTML5 target where possible, then builds/runs/tests the GameMaker project through the best available provider, including `gm-cli` where available.
10. Agent inspects logs and structured diagnostics.
11. Agent fixes failures.
12. Agent commits or opens a PR.
13. Scheduled agents continue from the task graph.
```

## 16. Recommended Implementation Order

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

### Phase 5: Agent Skills and Task Graph

Deliver:

```text
game-design skill
gamemaker-resources skill
task schema
tasks CLI commands
CLI/MCP catalog coverage
```

### Phase 6: Scheduled and Subagent Workflows

Deliver:

```text
scheduled game-planning workflow
sequential subagent roles
machine-readable summaries
task graph updates
validation-gated PR flow
```

## 17. Highest-Leverage Immediate PRs

1. **Implement one high-value mutation command family.**
   Best first target: `object event update`, because agents need a reliable way to put behavior into objects after creating or selecting a resource.

2. **Add or harden a `gm-cli resourcetool` integration slice.**
   Start with one mutation or inspection class, normalize the result into GMLoop's structured command contract, and prove the MCP catalog exposes the GMLoop command rather than a parallel MCP-only tool.

3. **Improve structured JSON output for resource mutations.**
   Agent/MCP usage benefits from consistent JSON payloads, deterministic ordering, dry-run summaries, and actionable error codes.

4. **Add MCP catalog tests for autonomous-game commands.**
   Verify the MCP server exposes CLI-backed tools automatically and keeps names, schemas, write behavior, and result payloads stable.

5. **Implement `test case create/update`.**
   This connects the existing `test` command family to real test authoring.

6. **Add a minimal `gml-kit` helper library.**
   Start with a small manifest-driven library rather than a large prefab system.

7. **Audit and extend the runner/build surface around `gm-cli`.**
   Start with provider contracts, `gm-cli` capability detection, fixture providers, and log parsing before committing to a specific local or CI backend.

8. **Add game-design and GameMaker-resource agent skills.**
   Improve agent behavior before large automation is attempted.

9. **Add a task graph.**
   Enable scheduled agents and subagents to coordinate through explicit state.

## 18. Open Questions

1. Which `gm-cli` versions should GMLoop support or require for the first official-provider integration?
2. Which GameMaker targets, runtimes, and toolchains should the first `gm-cli` build/run provider support?
3. Can the open-source Stitch GitHub Action reliably build the target project types in CI, and should it remain a secondary provider behind `gm-cli`?
4. When should GMLoop call `gm-cli resourcetool` directly versus use internal refactor/resource APIs?
5. Should GMLoop expose any read-only bridge to `gm-cli manual`, or should manual lookup stay a provider behind specific planning/diagnostic commands?
6. Should the reusable GML kit be shipped as source resources, package artifacts, or project templates?
7. How should generated projects distinguish production resources from test-only resources?
8. What is the minimum viable headless test runner for the existing unit-test framework?
9. Should generated games keep `.gmloop` metadata in the project root, or should metadata live outside the GameMaker project tree?
10. How much of the runtime/playtest loop can be automated through HTML5 export, `gm-cli run`, and browser automation?
11. What subagent roles should run in parallel versus sequentially?
12. Is the current CLI metadata rich enough for all future autonomous-game MCP schemas, or does the CLI catalog need additional option/argument annotations?
13. Should MCP expose any additional read-only GameMaker project resources beyond CLI tools, such as `gm://project/overview` or `gm://resource/<name>`?
14. Should human-readable mutation commands support `--json` consistently before agents rely on them heavily?

## 19. Summary

The next stage for GMLoop is to become a GameMaker autonomous development platform, not only a set of GML code tools. The core unlocks are:

```text
completion of existing resource/object/room/test command surfaces
CLI-backed agent tool commands
existing MCP exposure through the CLI catalog
official `gm-cli` integration for project, ResourceTool, build/run/package, manual, and publish workflows
reusable GML helper systems
unit-test generation and execution
GameMaker build/run validation
game-design agent skills
task graph orchestration
scheduled and subagent workflows
```

The first priority should be completing high-level GameMaker mutation, validation, and provider-integration paths that let agents create resources, edit object events, place room instances, author tests, and prove builds without raw project-file edits. The MCP server should surface those capabilities through its CLI-derived tool catalog. `gm-cli` should be integrated where it provides official GameMaker lifecycle behavior, while GMLoop continues to own semantic analysis, hot reload, structured automation contracts, and autonomous workflow orchestration.
