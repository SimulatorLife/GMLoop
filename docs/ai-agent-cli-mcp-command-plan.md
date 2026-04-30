# AI-Agent CLI + MCP Command Plan

This document defines the proposed AI-agent command/tool surface for GMLoop. It standardizes naming, identifies which items should become top-level commands vs subcommands vs options, maps each capability to the owning workspace, assigns priority, and records the desired CLI and MCP names.

The intended target is the GameMaker HTML5 runtime used with GMLoop's live/hot-reloading workflow. This proposal assumes agents will also use a browser automation MCP server such as Playwright alongside `@gmloop/mcp`.

## Decisions

| Decision | Recommendation |
| --- | --- |
| CLI naming | Use domain-noun top-level commands with short verb subcommands: `resource add`, `room list`, `runner logs`, `symbol inspect`. |
| MCP naming | Derive tool names from the CLI leaf path with a `gmloop_` prefix and underscores: `gmloop_resource_add`, `gmloop_graph_search`, `gmloop_runner_logs`. |
| CLI as source of truth | The `@gmloop/cli` command catalog is the single source of truth for the public agent-control surface. |
| MCP architecture | `@gmloop/mcp` should remain a thin wrapper over the CLI catalog. No MCP-only business logic, no standalone/static/predefined MCP tool definitions, and no MCP-only command surfaces. |
| Runtime target | Design these tools for the HTML5 runtime and GMLoop hot-reload workflow rather than as a general desktop/IDE automation surface. |
| Browser automation boundary | Do not recreate browser automation capabilities already covered by Playwright/browser MCP servers, such as screenshots, keyboard input, mouse input, browser navigation, DOM inspection, or viewport emulation. |
| Reuse over reinvention | Prefer building on existing GameMaker tooling such as Stitch, `@bscotch/yy`, launcher/build helpers, and related automation references wherever practical instead of reimplementing the same capability from scratch. |
| Standalone vs options | Prefer one command per domain action and move “getter/setter explosion” into `inspect`, `update`, `validate`, `query`, `state`, `logs`, `capture`, and `report` subcommands with explicit options. |
| Graph commands | Keep `graph index`, `graph search`, `graph doctor`, `graph visualize`. Place symbol-centric graph queries under a separate `symbol` suite for AI ergonomics. |
| Symbol inspection | Use `symbol inspect` as the unified symbol entrypoint instead of a builtin-only special-case command. |
| Legacy-style prefixes | Do not use `gml_` prefixes. Keep CLI command names unprefixed, but use a `gmloop_` prefix for MCP tool names. |

## CLI/MCP Contract

| Rule | Requirement |
| --- | --- |
| Source of truth | The CLI command catalog defines the canonical public surface area. If a capability should be exposed to AI agents, it must first exist as a real CLI command/subcommand. |
| MCP derivation | Every MCP tool must be generated dynamically from the CLI command catalog and must mirror the CLI leaf command name, description, arguments, and options. |
| No standalone MCP tools | Do not add any handwritten, static, predefined, or MCP-only tool definitions for command execution. |
| No parallel command surfaces | Do not create capabilities that exist only in MCP and not in the CLI. |
| DRY schema ownership | Argument parsing, option names, defaults, validation, and help text should be owned once by the CLI and reused by MCP generation. |
| Change workflow | To add, remove, or rename an MCP tool, change the CLI command definition; the MCP surface should update automatically from that. |
| Resources exception | MCP resources may still exist where appropriate, but command-like behavior must come from the CLI-derived tool catalog rather than a separate MCP-only command registry. |
| Browser-tool exception | Browser automation primitives should be delegated to Playwright/browser MCP tooling rather than reimplemented in `@gmloop/mcp`. |
| Dependency strategy | When a third-party package already solves the underlying GameMaker project, launcher, or build concern well, prefer adding it as a dependency and wrapping it cleanly in `@gmloop/cli` rather than reimplementing the same logic internally. |

## External Tooling Strategy

| Source | How to use it in this plan |
| --- | --- |
| [bscotch/stitch](https://github.com/bscotch/stitch) | Primary upstream reference for GameMaker project automation patterns. Reuse concepts, data modeling, and package-level capabilities where they fit GMLoop's architecture. |
| [bscotch/stitch `packages/yy`](https://github.com/bscotch/stitch/tree/develop/packages/yy) | Preferred source for `.yy`/`.yyp` schema handling and project metadata I/O where it avoids reimplementing GameMaker resource metadata logic. |
| [bscotch/stitch `packages/launcher`](https://github.com/bscotch/stitch/tree/develop/packages/launcher) | Preferred source for launching projects, managing runtimes, and build/run orchestration where it fits the HTML5/hot-reload workflow. |
| [GameMaker manual: Building via Command Line (LTS)](https://manual.gamemaker.io/lts/en/Settings/Building_via_Command_Line.htm) | Reference for official GameMaker CLI/build invocation behavior and supported flags. |
| [GameMaker manual: Building via Command Line (monthly)](https://manual.gamemaker.io/monthly/en/#t=Settings%2FBuilding_via_Command_Line.htm) | Reference for the newer monthly-channel command-line build behavior and flag surface. |
| [YoYo Games blog: Automate builds](https://gamemaker.io/en/blog/bs-tech-automate-builds) | Reference for supported GameMaker build automation workflows and CI-oriented patterns. |
| [Atennebris/GMSync](https://github.com/Atennebris/GMSync) | Reference for GameMaker synchronization/automation ideas and implementation patterns that may inform runtime or project tooling. |
| [GitHub Actions overview](https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions#workflows) | Reference for CI/workflow terminology and workflow-model expectations when designing build/test automation integrations. |
| [bscotch/igor-setup](https://github.com/bscotch/igor-setup) | Reference and possible dependency for setting up Igor/GameMaker build prerequisites in automation contexts. |
| [bscotch/igor-build](https://github.com/bscotch/igor-build) | Reference and possible dependency for Igor/GameMaker build invocation in automation contexts. |
| [actions/upload-artifact](https://github.com/actions/upload-artifact) | Reference for CI artifact publication patterns when GMLoop build commands are wired into GitHub Actions. |
| [darkw3bb/GameMaker-MCP-Server](https://github.com/darkw3bb/GameMaker-MCP-Server) | Reference for adjacent MCP server design ideas and scope decisions. Use as a comparison point, not as the source of truth. |

## Reuse Policy

| Rule | Requirement |
| --- | --- |
| Prefer upstream packages | Before implementing new GameMaker project/build/launcher functionality, check whether Stitch or related Bscotch packages already provide a usable foundation. |
| Wrap in CLI, do not bypass CLI | Even when third-party packages are used under the hood, expose their capabilities through GMLoop CLI commands rather than creating direct MCP-only integrations. |
| Preserve workspace boundaries | Third-party integrations should sit behind the appropriate GMLoop workspace or CLI command layer and must not blur parser/core/plugin ownership boundaries. |
| Reuse for implementation and reference | External sources may be used both as runtime dependencies and as references/examples for shaping GMLoop's own implementation. |
| Avoid duplicate ownership | If Stitch or an adjacent dependency already handles `.yy` metadata, launcher management, or build invocation well, do not create a second competing implementation unless GMLoop has a clear architectural reason. |

## Recommended Top-Level CLI Taxonomy

| Top-level command | Purpose | Primary backing workspace(s) |
| --- | --- | --- |
| `graph` | Build/query the semantic graph index | `@gmloop/semantic` |
| `symbol` | Inspect one symbol, its metadata, and relationships | `@gmloop/semantic` |
| `validate` | Validate GML/project/room/resource inputs | `@gmloop/parser`, `@gmloop/semantic`, `@gmloop/refactor` |
| `resource` | Project resource inventory, metadata, and mutations | `@gmloop/semantic`, `@gmloop/refactor` |
| `room` | Static room inspection, edits, validation, preview, and analysis | `@gmloop/semantic`, `@gmloop/refactor`, `@gmloop/ui` |
| `object` | Static object inspection and edits | `@gmloop/semantic`, `@gmloop/refactor` |
| `runner` | GameMaker process lifecycle, logs, and room switching | `@gmloop/cli`, `@gmloop/runtime-wrapper` |
| `runtime` | Live in-game state inspection/mutation/calls | `@gmloop/runtime-wrapper`, `@gmloop/transpiler`, `@gmloop/cli` |
| `profile` | Runtime profiling and performance reports | `@gmloop/runtime-wrapper`, `@gmloop/cli` |
| `test` | Discover/run/update tests | `@gmloop/cli`, `@gmloop/runtime-wrapper` |
| `replay` | Record/replay/assert deterministic sessions | `@gmloop/runtime-wrapper`, `@gmloop/cli` |
| `ui` | UI validation, preview, and scaffolding | `@gmloop/ui`, `@gmloop/refactor`, `@gmloop/cli` |
| `project` | Project/IDE hygiene tasks such as cache cleanup | `@gmloop/cli` |

## Canonical AI-Agent Command Surface

| Canonical capability | Parent CLI command | Subcommands | Standalone vs option decision | Primary backing workspace(s) | Priority | Implemented now? | Desired CLI / MCP name(s) | Core params/options |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Graph index + discovery | `graph` | `index`, `search`, `doctor`, `visualize` | Keep as standalone graph subcommands | `@gmloop/semantic`, `@gmloop/ui` | High | Yes | CLI: `graph index`, `graph search`, `graph doctor`, `graph visualize`; MCP: `gmloop_graph_index`, `gmloop_graph_search`, `gmloop_graph_doctor`, `gmloop_graph_visualize` | `--path`, `--config`, `--toolset-root`, `--database-path`, `--json`, `--force`, `--limit`, `--output`, `--open`, `--serve` |
| Symbol inspection + relationships | `symbol` | `inspect`, `context`, `neighbors`, `usages` | Top-level suite; absorb builtin lookup and symbol-centric graph leaf commands | `@gmloop/semantic` | High | Partial | CLI: `symbol inspect`, `symbol context`, `symbol neighbors`, `symbol usages`; MCP: `gmloop_symbol_inspect`, `gmloop_symbol_context`, `gmloop_symbol_neighbors`, `gmloop_symbol_usages` | `identifierOrId`, `--source builtin|project|auto`, `--path`, `--config`, `--toolset-root`, `--depth`, `--json` |
| Validation | `validate` | `file`, `project`, `room`, `resource` | Top-level suite; do not overload `parse` for agent-facing validation | `@gmloop/parser`, `@gmloop/semantic`, `@gmloop/refactor` | High | Partial | CLI: `validate file`, `validate project`, `validate room`, `validate resource`; MCP: `gmloop_validate_file`, `gmloop_validate_project`, `gmloop_validate_room`, `gmloop_validate_resource` | `target`, `--kind auto|gml|yy|yyp|shader`, `--scope syntax|references|all`, `--json`, `--fix` |
| Resource inventory + metadata | `resource` | `list`, `find`, `inspect`, `deps`, `dependents`, `audit` | Keep as subcommands; use `inspect` and `audit` instead of many tiny getters/checkers | `@gmloop/semantic` | High | Partial | CLI: `resource list`, `resource find`, `resource inspect`, `resource deps`, `resource dependents`, `resource audit`; MCP: `gmloop_resource_list`, `gmloop_resource_find`, `gmloop_resource_inspect`, `gmloop_resource_deps`, `gmloop_resource_dependents`, `gmloop_resource_audit` | `nameOrGuid`, `--kind`, `--path`, `--json`, `--check unused|missing-references|references|all` |
| Resource mutations | `resource` | `add`, `remove`, `rename`, `duplicate`, `move` | Keep as explicit mutations | `@gmloop/refactor` | High | Partial | CLI: `resource add`, `resource remove`, `resource rename`, `resource duplicate`, `resource move`; MCP: `gmloop_resource_add`, `gmloop_resource_remove`, `gmloop_resource_rename`, `gmloop_resource_duplicate`, `gmloop_resource_move` | `<kind>`, `<name>`, `--new-name`, `--destination-folder`, `--path`, `--write`, `--json` |
| Room inspection + analysis | `room` | `list`, `inspect`, `query`, `validate`, `preview`, `summary` | New suite; collapse room getters into `inspect`, queries into `query`, summaries into `summary` | `@gmloop/semantic`, `@gmloop/ui` | High | No | CLI: `room list`, `room inspect`, `room query`, `room validate`, `room preview`, `room summary`; MCP: `gmloop_room_list`, `gmloop_room_inspect`, `gmloop_room_query`, `gmloop_room_validate`, `gmloop_room_preview`, `gmloop_room_summary` | `room`, `--path`, `--json`, `--mode at-point|in-rect|near|overlapping|out-of-bounds|empty-space|nearest-instance|instances-by-object`, geometry args, `--format summary|ascii|occupancy` |
| Room mutations | `room` | `create`, `duplicate`, `rename`, `delete`, `update`, `repair` | New suite; collapse setters into `update` | `@gmloop/refactor` | High | No | CLI: `room create`, `room duplicate`, `room rename`, `room delete`, `room update`, `room repair`; MCP: `gmloop_room_create`, `gmloop_room_duplicate`, `gmloop_room_rename`, `gmloop_room_delete`, `gmloop_room_update`, `gmloop_room_repair` | `room`, `--new-name`, `--width`, `--height`, `--speed`, `--persistent`, `--background-color`, `--creation-code`, `--write`, `--json` |
| Room instance operations | `room` | `instance add`, `instance update`, `instance delete` | Nested subcommands; remove separate instance-in-room tools | `@gmloop/refactor`, `@gmloop/semantic` | High | No | CLI: `room instance add`, `room instance update`, `room instance delete`; MCP: `gmloop_room_instance_add`, `gmloop_room_instance_update`, `gmloop_room_instance_delete` | `room`, `instanceId?`, `object`, `--layer`, `--x`, `--y`, `--creation-code`, `--json`, `--write` |
| Room layer + camera operations | `room` | `layer list`, `layer inspect`, `layer create`, `layer update`, `layer delete`, `layer reorder`, `layer move-resource`, `camera list`, `camera inspect`, `camera update`, `camera frame` | Nested subcommands; collapse setters/getters into `inspect`/`update`/`frame` | `@gmloop/refactor`, `@gmloop/semantic` | Medium | No | CLI: `room layer ...`, `room camera ...`; MCP: `gmloop_room_layer_list`, `gmloop_room_layer_inspect`, `gmloop_room_layer_create`, `gmloop_room_layer_update`, `gmloop_room_layer_delete`, `gmloop_room_layer_reorder`, `gmloop_room_layer_move_resource`, `gmloop_room_camera_list`, `gmloop_room_camera_inspect`, `gmloop_room_camera_update`, `gmloop_room_camera_frame` | `room`, `layer`, `camera`, `--kind`, `--depth`, `--visible`, `--locked`, `--view-rect`, `--port-rect`, `--follow-object`, `--border`, `--speed`, `--target` |
| Object inspection + mutations | `object` | `list`, `inspect`, `update`, `validate`, `event list`, `event inspect`, `event add`, `event update`, `event delete` | New suite; collapse simple getters/setters into `inspect`/`update`; keep event edits explicit | `@gmloop/semantic`, `@gmloop/refactor` | High | No | CLI: `object list`, `object inspect`, `object update`, `object validate`, `object event ...`; MCP: `gmloop_object_list`, `gmloop_object_inspect`, `gmloop_object_update`, `gmloop_object_validate`, `gmloop_object_event_list`, `gmloop_object_event_inspect`, `gmloop_object_event_add`, `gmloop_object_event_update`, `gmloop_object_event_delete` | `object`, `event`, `--parent`, `--sprite`, `--mask`, `--physics-settings`, `--code`, `--json`, `--write` |
| Runner lifecycle + logs | `runner` | `start`, `stop`, `restart`, `pause`, `resume`, `status`, `logs`, `clear-logs`, `room set`, `room current` | New suite; absorb game launch/kill, compile errors, and runtime log tools. Browser input and screenshot/video capture stay out of scope because Playwright/browser MCP tools already cover them. | `@gmloop/cli`, `@gmloop/runtime-wrapper` | High | Partial | CLI: `runner start`, `runner stop`, `runner restart`, `runner pause`, `runner resume`, `runner status`, `runner logs`, `runner clear-logs`, `runner room set`, `runner room current`; MCP: `gmloop_runner_start`, `gmloop_runner_stop`, `gmloop_runner_restart`, `gmloop_runner_pause`, `gmloop_runner_resume`, `gmloop_runner_status`, `gmloop_runner_logs`, `gmloop_runner_clear_logs`, `gmloop_runner_room_set`, `gmloop_runner_room_current` | `--project`, `--runner`, `--debug`, `--follow`, `--kind runtime|compile|all`, `--errors-only`, `--filter`, `--json`, `room` |
| Live runtime inspection + mutation | `runtime` | `instances`, `inspect`, `get`, `set`, `call`, `watch`, `state`, `logs` | New suite; collapse room/camera/draw/audio state into `state --kind ...` | `@gmloop/runtime-wrapper`, `@gmloop/transpiler`, `@gmloop/cli` | High | No | CLI: `runtime instances`, `runtime inspect`, `runtime get`, `runtime set`, `runtime call`, `runtime watch`, `runtime state`, `runtime logs`; MCP: `gmloop_runtime_instances`, `gmloop_runtime_inspect`, `gmloop_runtime_get`, `gmloop_runtime_set`, `gmloop_runtime_call`, `gmloop_runtime_watch`, `gmloop_runtime_state`, `gmloop_runtime_logs` | `instanceId`, `path`, `expression`, `--scope instance|global`, `--kind room|camera|draw|audio`, `--method`, `--args`, `--json` |
| Profiling | `profile` | `start`, `stop`, `snapshot`, `compare`, `report` | New suite; collapse many metric getters into `report --metrics ...` | `@gmloop/runtime-wrapper`, `@gmloop/cli` | Medium | No | CLI: `profile start`, `profile stop`, `profile snapshot`, `profile compare`, `profile report`; MCP: `gmloop_profile_start`, `gmloop_profile_stop`, `gmloop_profile_snapshot`, `gmloop_profile_compare`, `gmloop_profile_report` | `--metrics fps,frame-time,memory,draw-calls,texture-swaps,instance-counts,room-load-time,script-timings,gc-pressure`, `--output`, `--baseline`, `--json` |
| Tests | `test` | `list`, `run`, `results`, `case create`, `case update` | New suite; absorb `run_group` into `run --group` | `@gmloop/cli`, `@gmloop/runtime-wrapper` | Medium | No | CLI: `test list`, `test run`, `test results`, `test case create`, `test case update`; MCP: `gmloop_test_list`, `gmloop_test_run`, `gmloop_test_results`, `gmloop_test_case_create`, `gmloop_test_case_update` | `--group`, `--filter`, `--update`, `--json`, `--output` |
| Replays | `replay` | `record`, `run`, `compare`, `assert` | New suite; collapse assertion variants into `assert --kind ...` | `@gmloop/runtime-wrapper`, `@gmloop/cli` | Medium | No | CLI: `replay record`, `replay run`, `replay compare`, `replay assert`; MCP: `gmloop_replay_record`, `gmloop_replay_run`, `gmloop_replay_compare`, `gmloop_replay_assert` | `--kind room|instance-exists|variable|no-errors`, `--room`, `--instance`, `--expression`, `--expected`, `--json` |
| UI validation + scaffolding | `ui` | `inspect`, `validate`, `preview`, `scaffold` | New suite; collapse checks into `validate --checks ...`; collapse creation helpers into `scaffold --template ...` | `@gmloop/ui`, `@gmloop/refactor`, `@gmloop/cli` | Medium | No | CLI: `ui inspect`, `ui validate`, `ui preview`, `ui scaffold`; MCP: `gmloop_ui_inspect`, `gmloop_ui_validate`, `gmloop_ui_preview`, `gmloop_ui_scaffold` | `--checks layout,anchors,text-overflow,safe-area`, `--template placeholder-hud|menu-room|button|text`, `--resolution`, `--json`, `--write` |
| Project cache cleanup | `project` | `cache clean` | Keep as low-priority hygiene task, not a large suite | `@gmloop/cli` | Low | No | CLI: `project cache clean`; MCP: `gmloop_project_cache_clean` | `--project`, `--ide`, `--runner`, `--json`, `--force` |

## Existing CLI Cleanup Recommendations

These are not all in the AI-agent TODO list, but they are worth standardizing because the same CLI catalog drives MCP naming.

| Current CLI name | Current role | Target CLI name | Reason |
| --- | --- | --- | --- |
| `lookup-gml-identifier` | Builtin-only symbol lookup | `symbol inspect` | Too specific and inconsistent with the graph-backed symbol model |
| `watch-status` | Poll watch HTTP server | `watch status` | Hyphenated singleton breaks the otherwise grouped command style |
| `generate-gml-identifiers` | Manual snapshot generation | `manual identifiers build` | Better grouped naming if it remains public |
| `generate-feather-metadata` | Manual snapshot generation | `manual feather build` | Better grouped naming if it remains public |
| `generate-quality-report` | Reporting | `report quality` | Better grouped naming if it remains public |
| `prepare-hot-reload` | Runtime prep | `runtime prepare` or `runner prepare` | Better grouped naming if it remains public |

## Priority Order for AI-Agent v1

| Priority | Recommended first batch |
| --- | --- |
| High | `graph search`, `symbol inspect`, `validate file`, `validate project`, `resource list/find/inspect`, `resource add/remove/rename`, `room list/inspect/update/instance add`, `object inspect/update/event update`, `runner start/stop/status/logs`, `runtime get/set/call/watch` |
| Medium | `resource deps/dependents/audit`, `room preview/query/camera/layer`, `profile`, `test`, `replay`, `ui` |
| Low | `project cache clean`, IDE/open-style flows, anything that only wraps an editor convenience rather than enabling autonomous agent work |

## Explicitly Out Of Scope for `@gmloop/mcp`

| Capability class | Why it is out of scope |
| --- | --- |
| Browser screenshots and page/video capture | Already handled by Playwright/browser MCP tools. |
| Browser keyboard, mouse, and gamepad interaction | Already handled by Playwright/browser MCP tools. |
| Browser navigation, DOM inspection, and viewport/device emulation | Already handled by Playwright/browser MCP tools. |
| Generic browser-state observation | Already handled by Playwright/browser MCP tools. |

## Notes on Current Implementation

| Area | Current status |
| --- | --- |
| CLI catalog -> MCP tool generation | Already implemented. The target should keep a `gmloop_` prefix consistently across MCP tool names. |
| Graph tools | Already implemented as `graph index/search/symbol/context/neighbors/usages/doctor/visualize`. |
| Resource mutations | Already implemented in part as `resource add` and `resource remove`, backed by `@gmloop/refactor`. |
| Builtin identifier lookup | Already implemented as `lookup-gml-identifier`, but it only covers the manual snapshot and should become part of `symbol inspect`. |
| Parse/validation | `parse` exists and is useful, but it is a low-level AST tool, not the final AI-facing validation surface. |
| Browser interaction surface | Should stay delegated to Playwright/browser MCP tooling rather than being added to `@gmloop/mcp`. |
| Runner/runtime/profile/test/replay/ui AI control | Not implemented yet as a coherent agent surface. |
