# AI-Agent CLI + MCP Command Plan

This document proposes AI-agent commands/tools list with standardized naming, identifies which items should become top-level commands vs subcommands vs options, maps each capability to the owning workspace, assigns priority, and records current vs target naming for both the `@gmloop/cli` and `@gmloop/mcp` workspaces.

## Decisions

| Decision | Recommendation |
| --- | --- |
| CLI naming | Use domain-noun top-level commands with short verb subcommands: `resource add`, `room list`, `runner logs`, `symbol inspect`. |
| MCP naming | Derive tool names from the CLI leaf path with underscores and no extra prefix: `resource_add`, `graph_search`, `runner_logs`. |
| MCP architecture | `@gmloop/mcp` should remain a thin wrapper over the CLI catalog. No MCP-only business logic. |
| Standalone vs options | Prefer one command per domain action and move “getter/setter explosion” into `inspect`, `update`, `validate`, `query`, `state`, `logs`, `capture`, and `report` subcommands with explicit options. |
| Existing graph commands | Keep `graph index`, `graph search`, `graph doctor`, `graph visualize`. Move symbol-centric graph leaf commands into a separate `symbol` suite for AI ergonomics. |
| Existing identifier lookup | Replace `lookup-gml-identifier` with `symbol inspect` instead of keeping a special one-off command. |
| Existing `gml_*` TODO names | Drop the `gml_` prefix entirely. The server already provides namespace/context. |
| Existing `gmloop_*` MCP names | Target state should also drop this prefix so MCP names mirror CLI leaf paths directly. |

## Recommended Top-Level CLI Taxonomy

| Top-level command | Purpose | Primary backing workspace(s) |
| --- | --- | --- |
| `graph` | Build/query the semantic graph index | `@gmloop/semantic` |
| `symbol` | Inspect one symbol, its metadata, and relationships | `@gmloop/semantic` |
| `validate` | Validate GML/project/room/resource inputs | `@gmloop/parser`, `@gmloop/semantic`, `@gmloop/refactor` |
| `resource` | Project resource inventory, metadata, and mutations | `@gmloop/semantic`, `@gmloop/refactor` |
| `room` | Static room inspection, edits, validation, preview, and analysis | `@gmloop/semantic`, `@gmloop/refactor`, `@gmloop/ui` |
| `object` | Static object inspection and edits | `@gmloop/semantic`, `@gmloop/refactor` |
| `runner` | GameMaker process lifecycle, logs, capture, and room switching | `@gmloop/cli`, `@gmloop/runtime-wrapper` |
| `runtime` | Live in-game state inspection/mutation/calls | `@gmloop/runtime-wrapper`, `@gmloop/transpiler`, `@gmloop/cli` |
| `profile` | Runtime profiling and performance reports | `@gmloop/runtime-wrapper`, `@gmloop/cli` |
| `test` | Discover/run/update tests | `@gmloop/cli`, `@gmloop/runtime-wrapper` |
| `replay` | Record/replay/assert deterministic sessions | `@gmloop/runtime-wrapper`, `@gmloop/cli` |
| `ui` | UI validation, preview, and scaffolding | `@gmloop/ui`, `@gmloop/refactor`, `@gmloop/cli` |
| `project` | Project/IDE hygiene tasks such as cache cleanup | `@gmloop/cli` |

## Canonical AI-Agent Command Surface

| Canonical capability | Parent CLI command | Subcommands | Standalone vs option decision | Primary backing workspace(s) | Priority | Implemented now? | Current CLI / MCP name(s) | Target CLI / MCP name(s) | Core params/options |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Graph index + discovery | `graph` | `index`, `search`, `doctor`, `visualize` | Keep as standalone graph subcommands | `@gmloop/semantic`, `@gmloop/ui` | High | Yes | CLI: `graph index`, `graph search`, `graph doctor`, `graph visualize`; MCP: `gmloop_graph_*` | Same CLI names; MCP: `graph_index`, `graph_search`, `graph_doctor`, `graph_visualize` | `--path`, `--config`, `--toolset-root`, `--database-path`, `--json`, `--force`, `--limit`, `--output`, `--open`, `--serve` |
| Symbol inspection + relationships | `symbol` | `inspect`, `context`, `neighbors`, `usages` | New top-level suite; absorb builtin lookup and symbol-centric graph leaf commands | `@gmloop/semantic` | High | Partial | CLI: `lookup-gml-identifier`, `graph symbol`, `graph context`, `graph neighbors`, `graph usages`; MCP: `gmloop_graph_symbol`, `gmloop_graph_context`, `gmloop_graph_neighbors`, `gmloop_graph_usages` | CLI: `symbol inspect`, `symbol context`, `symbol neighbors`, `symbol usages`; MCP: `symbol_inspect`, `symbol_context`, `symbol_neighbors`, `symbol_usages` | `identifierOrId`, `--source builtin|project|auto`, `--path`, `--config`, `--toolset-root`, `--depth`, `--json` |
| Validation | `validate` | `file`, `project`, `room`, `resource` | New top-level suite; do not overload `parse` for agent-facing validation | `@gmloop/parser`, `@gmloop/semantic`, `@gmloop/refactor` | High | Partial | CLI: `parse`, `lint`, `graph doctor`; MCP: `gmloop_parse`, `gmloop_lint`, `gmloop_graph_doctor` | CLI: `validate file`, `validate project`, `validate room`, `validate resource`; MCP: `validate_file`, `validate_project`, `validate_room`, `validate_resource` | `target`, `--kind auto|gml|yy|yyp|shader`, `--scope syntax|references|all`, `--json`, `--fix` |
| Resource inventory + metadata | `resource` | `list`, `find`, `inspect`, `deps`, `dependents`, `audit` | Keep as subcommands; absorb `exists`, `get_guid`, `resolve_guid`, `get_type` into `inspect`; absorb unused/missing/reference checks into `audit` | `@gmloop/semantic` | High | Partial | CLI: none for read-side; MCP: none | CLI: `resource list`, `resource find`, `resource inspect`, `resource deps`, `resource dependents`, `resource audit`; MCP: `resource_list`, `resource_find`, `resource_inspect`, `resource_deps`, `resource_dependents`, `resource_audit` | `nameOrGuid`, `--kind`, `--path`, `--json`, `--check unused|missing-references|references|all` |
| Resource mutations | `resource` | `add`, `remove`, `rename`, `duplicate`, `move` | Keep as explicit mutations | `@gmloop/refactor` | High | Partial | CLI: `resource add`, `resource remove`; MCP: `gmloop_resource_add`, `gmloop_resource_remove` | CLI: same plus `rename`, `duplicate`, `move`; MCP: `resource_add`, `resource_remove`, `resource_rename`, `resource_duplicate`, `resource_move` | `<kind>`, `<name>`, `--new-name`, `--destination-folder`, `--path`, `--write`, `--json` |
| Room inspection + analysis | `room` | `list`, `inspect`, `query`, `validate`, `preview`, `summary` | New suite; collapse most room getters into `inspect`; collapse spatial queries into `query`; collapse layout/ascii/occupancy into `summary` | `@gmloop/semantic`, `@gmloop/ui` | High | No | None | CLI: `room list`, `room inspect`, `room query`, `room validate`, `room preview`, `room summary`; MCP: `room_list`, `room_inspect`, `room_query`, `room_validate`, `room_preview`, `room_summary` | `room`, `--path`, `--json`, `--mode at-point|in-rect|near|overlapping|out-of-bounds|empty-space|nearest-instance|instances-by-object`, geometry args, `--format summary|ascii|occupancy` |
| Room mutations | `room` | `create`, `duplicate`, `rename`, `delete`, `update`, `repair` | New suite; collapse room setters into `update`; prefer `repair` or `validate --fix` over many ad hoc fix tools | `@gmloop/refactor` | High | No | None | CLI: `room create`, `room duplicate`, `room rename`, `room delete`, `room update`, `room repair`; MCP: `room_create`, `room_duplicate`, `room_rename`, `room_delete`, `room_update`, `room_repair` | `room`, `--new-name`, `--width`, `--height`, `--speed`, `--persistent`, `--background-color`, `--creation-code`, `--write`, `--json` |
| Room instance operations | `room` | `instance add`, `instance update`, `instance delete` | Nested subcommands; remove separate top-level instance-in-room tools | `@gmloop/refactor`, `@gmloop/semantic` | High | No | None | CLI: `room instance add`, `room instance update`, `room instance delete`; MCP: `room_instance_add`, `room_instance_update`, `room_instance_delete` | `room`, `instanceId?`, `object`, `--layer`, `--x`, `--y`, `--creation-code`, `--json`, `--write` |
| Room layer + camera operations | `room` | `layer list`, `layer inspect`, `layer create`, `layer update`, `layer delete`, `layer reorder`, `layer move-resource`, `camera list`, `camera inspect`, `camera update`, `camera frame` | Nested subcommands; collapse many setters/getters into `inspect`/`update`/`frame` | `@gmloop/refactor`, `@gmloop/semantic` | Medium | No | None | CLI: `room layer ...`, `room camera ...`; MCP: `room_layer_list`, `room_layer_inspect`, `room_layer_create`, `room_layer_update`, `room_layer_delete`, `room_layer_reorder`, `room_layer_move_resource`, `room_camera_list`, `room_camera_inspect`, `room_camera_update`, `room_camera_frame` | `room`, `layer`, `camera`, `--kind`, `--depth`, `--visible`, `--locked`, `--view-rect`, `--port-rect`, `--follow-object`, `--border`, `--speed`, `--target` |
| Object inspection + mutations | `object` | `list`, `inspect`, `update`, `validate`, `event list`, `event inspect`, `event add`, `event update`, `event delete` | New suite; collapse simple getters/setters into `inspect`/`update`; keep event edits explicit | `@gmloop/semantic`, `@gmloop/refactor` | High | No | None | CLI: `object list`, `object inspect`, `object update`, `object validate`, `object event ...`; MCP: `object_list`, `object_inspect`, `object_update`, `object_validate`, `object_event_list`, `object_event_inspect`, `object_event_add`, `object_event_update`, `object_event_delete` | `object`, `event`, `--parent`, `--sprite`, `--mask`, `--physics-settings`, `--code`, `--json`, `--write` |
| Runner lifecycle + logs | `runner` | `start`, `stop`, `restart`, `pause`, `resume`, `status`, `logs`, `clear-logs`, `room set`, `room current` | New suite; absorb `launch_game`, `kill_game`, `collect_compile_errors`, and runtime log tools | `@gmloop/cli`, `@gmloop/runtime-wrapper` | High | Partial | CLI: `watch`, `watch-status` are adjacent but not true runner control; MCP: `gmloop_watch`, `gmloop_watch_status` | CLI: `runner start`, `runner stop`, `runner restart`, `runner pause`, `runner resume`, `runner status`, `runner logs`, `runner clear-logs`, `runner room set`, `runner room current`; MCP: `runner_start`, `runner_stop`, `runner_restart`, `runner_pause`, `runner_resume`, `runner_status`, `runner_logs`, `runner_clear_logs`, `runner_room_set`, `runner_room_current` | `--project`, `--runner`, `--debug`, `--follow`, `--kind runtime|compile|all`, `--errors-only`, `--filter`, `--json`, `room` |
| Runner input + capture | `runner` | `input`, `capture screenshot`, `capture video` | Keep as explicit leafs; collapse keyboard/mouse/gamepad into `input --device ...` | `@gmloop/runtime-wrapper`, `@gmloop/cli` | Medium | No | None | CLI: `runner input`, `runner capture screenshot`, `runner capture video`; MCP: `runner_input`, `runner_capture_screenshot`, `runner_capture_video` | `--device keyboard|mouse|gamepad`, `--event`, `--button`, `--x`, `--y`, `--output`, `--duration`, `--json` |
| Live runtime inspection + mutation | `runtime` | `instances`, `inspect`, `get`, `set`, `call`, `watch`, `state`, `logs` | New suite; collapse room/camera/draw/audio state into `state --kind ...` | `@gmloop/runtime-wrapper`, `@gmloop/transpiler`, `@gmloop/cli` | High | No | None | CLI: `runtime instances`, `runtime inspect`, `runtime get`, `runtime set`, `runtime call`, `runtime watch`, `runtime state`, `runtime logs`; MCP: `runtime_instances`, `runtime_inspect`, `runtime_get`, `runtime_set`, `runtime_call`, `runtime_watch`, `runtime_state`, `runtime_logs` | `instanceId`, `path`, `expression`, `--scope instance|global`, `--kind room|camera|draw|audio`, `--method`, `--args`, `--json` |
| Profiling | `profile` | `start`, `stop`, `snapshot`, `compare`, `report` | New suite; collapse many `get_*` commands into `report --metrics ...` | `@gmloop/runtime-wrapper`, `@gmloop/cli` | Medium | No | None | CLI: `profile start`, `profile stop`, `profile snapshot`, `profile compare`, `profile report`; MCP: `profile_start`, `profile_stop`, `profile_snapshot`, `profile_compare`, `profile_report` | `--metrics fps,frame-time,memory,draw-calls,texture-swaps,instance-counts,room-load-time,script-timings,gc-pressure`, `--output`, `--baseline`, `--json` |
| Tests | `test` | `list`, `run`, `results`, `case create`, `case update` | New suite; absorb `run_group` into `run --group` | `@gmloop/cli`, `@gmloop/runtime-wrapper` | Medium | No | None | CLI: `test list`, `test run`, `test results`, `test case create`, `test case update`; MCP: `test_list`, `test_run`, `test_results`, `test_case_create`, `test_case_update` | `--group`, `--filter`, `--update`, `--json`, `--output` |
| Replays | `replay` | `record`, `run`, `compare`, `assert` | New suite; collapse all assertion variants into `assert --kind ...` | `@gmloop/runtime-wrapper`, `@gmloop/cli` | Medium | No | None | CLI: `replay record`, `replay run`, `replay compare`, `replay assert`; MCP: `replay_record`, `replay_run`, `replay_compare`, `replay_assert` | `--kind room|instance-exists|variable|no-errors`, `--room`, `--instance`, `--expression`, `--expected`, `--json` |
| UI validation + scaffolding | `ui` | `inspect`, `validate`, `preview`, `scaffold` | New suite; collapse specific checks into `validate --checks ...`; collapse placeholder/menu/button/text creators into `scaffold --template ...` | `@gmloop/ui`, `@gmloop/refactor`, `@gmloop/cli` | Medium | No | None | CLI: `ui inspect`, `ui validate`, `ui preview`, `ui scaffold`; MCP: `ui_inspect`, `ui_validate`, `ui_preview`, `ui_scaffold` | `--checks layout,anchors,text-overflow,safe-area`, `--template placeholder-hud|menu-room|button|text`, `--resolution`, `--json`, `--write` |
| Project cache cleanup | `project` | `cache clean` | Keep as low-priority hygiene task, not a large suite | `@gmloop/cli` | Low | No | None | CLI: `project cache clean`; MCP: `project_cache_clean` | `--project`, `--ide`, `--runner`, `--json`, `--force` |

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

## Raw TODO Mapping

This table maps each original TODO item to the proposed canonical surface.

| Original TODO item | Keep / merge / drop | Canonical target |
| --- | --- | --- |
| Validate `.gml`, `.yy`, `.yyp`, shader files | Merge | `validate file`, `validate project` |
| Inspect identifier / builtin metadata / user-defined metadata | Merge | `symbol inspect` |
| `read_runtime_log` | Merge | `runner logs --follow` |
| `kill_game` | Merge | `runner stop` |
| `collect_compile_errors` | Merge | `runner logs --kind compile --errors-only` |
| `launch_game` | Merge | `runner start` |
| `clean_cache` | Keep | `project cache clean` |
| Performance profiling command | Merge | `profile report`, `profile start`, `profile stop`, `profile snapshot`, `profile compare` |
| Add to room command | Merge | `room instance add`, `room layer create --kind ...` |
| `list_rooms` | Merge | `room list` |
| `read_room` | Merge | `room inspect` |
| `add_instance_to_room` | Merge | `room instance add` |
| `move_instance` | Merge | `room instance update --x --y` |
| `delete_instance` | Merge | `room instance delete` |
| `set_instance_creation_code` | Merge | `room instance update --creation-code` |
| `set_room_camera` | Merge | `room camera update` |
| `set_viewport` | Merge | `room camera update --port-rect` |
| `set_layer_depth` | Merge | `room layer update --depth` |
| `add_tile_layer` | Merge | `room layer create --kind tilemap` |
| `paint_tiles` | Merge | `room layer update --paint` or `room layer paint` |
| `validate_room_references` | Merge | `room validate --scope references` |
| `capture_room_preview` | Merge | `room preview` |
| `open_room_in_runner(room_name)` | Merge | `runner room set <room>` |
| `gml_resource_list` | Merge | `resource list` |
| `gml_resource_find` | Merge | `resource find` |
| `gml_resource_get` | Merge | `resource inspect` |
| `gml_resource_exists` | Drop | Use `resource inspect` result or exit code |
| `gml_resource_rename` | Keep | `resource rename` |
| `gml_resource_duplicate` | Keep | `resource duplicate` |
| `gml_resource_move_folder` | Keep | `resource move` |
| `gml_resource_get_dependencies` | Keep | `resource deps` |
| `gml_resource_get_dependents` | Keep | `resource dependents` |
| `gml_resource_find_unused` | Merge | `resource audit --check unused` |
| `gml_resource_find_missing_references` | Merge | `resource audit --check missing-references` |
| `gml_resource_validate_references` | Merge | `resource audit --check references` |
| `gml_resource_get_guid` | Drop | Use `resource inspect` |
| `gml_resource_resolve_guid` | Merge | `resource inspect <guid>` |
| `gml_resource_get_type` | Drop | Use `resource inspect` |
| `gml_room_list` | Merge | `room list` |
| `gml_room_get` | Merge | `room inspect` |
| `gml_room_create` | Keep | `room create` |
| `gml_room_duplicate` | Keep | `room duplicate` |
| `gml_room_rename` | Keep | `room rename` |
| `gml_room_delete` | Keep | `room delete` |
| `gml_room_open` | Drop | Not needed for MCP v1; only reconsider if IDE automation becomes real scope |
| `gml_room_save` | Drop | Mutations should write atomically; no extra save tool |
| `gml_room_set_dimensions` | Merge | `room update --width --height` |
| `gml_room_get_dimensions` | Merge | `room inspect --fields dimensions` |
| `gml_room_set_speed` | Merge | `room update --speed` |
| `gml_room_set_persistent` | Merge | `room update --persistent` |
| `gml_room_set_background_color` | Merge | `room update --background-color` |
| `gml_room_get_creation_code` | Merge | `room inspect --fields creation-code` |
| `gml_room_set_creation_code` | Merge | `room update --creation-code` |
| `gml_room_validate` | Keep | `room validate` |
| `gml_room_repair` | Merge | `room repair` or `room validate --fix` |
| `gml_room_layer_list` | Merge | `room layer list` |
| `gml_room_layer_get` | Merge | `room layer inspect` |
| `gml_room_layer_create` | Merge | `room layer create` |
| `gml_room_layer_delete` | Merge | `room layer delete` |
| `gml_room_layer_rename` | Merge | `room layer update --name` |
| `gml_room_layer_set_depth` | Merge | `room layer update --depth` |
| `gml_room_layer_set_visible` | Merge | `room layer update --visible` |
| `gml_room_layer_set_locked` | Merge | `room layer update --locked` |
| `gml_room_layer_reorder` | Keep | `room layer reorder` |
| `gml_room_layer_move_resource` | Keep | `room layer move-resource` |
| `gml_room_layer_find_by_name` | Merge | `room layer inspect <name>` |
| `gml_room_layer_create_instance` | Merge | `room instance add --layer ...` |
| `gml_room_layer_create_tilemap` | Merge | `room layer create --kind tilemap` |
| `gml_room_layer_create_asset` | Merge | `room layer create --kind asset` |
| `gml_room_layer_create_background` | Merge | `room layer create --kind background` |
| `gml_room_layer_create_path` | Merge | `room layer create --kind path` |
| `gml_room_layer_create_effect` | Merge | `room layer create --kind effect` |
| `gml_room_query_at_point` | Merge | `room query --mode at-point` |
| `gml_room_query_in_rect` | Merge | `room query --mode in-rect` |
| `gml_room_query_near` | Merge | `room query --mode near` |
| `gml_room_query_overlapping` | Merge | `room query --mode overlapping` |
| `gml_room_query_out_of_bounds` | Merge | `room query --mode out-of-bounds` |
| `gml_room_query_empty_space` | Merge | `room query --mode empty-space` |
| `gml_room_query_nearest_instance` | Merge | `room query --mode nearest-instance` |
| `gml_room_query_instances_by_object` | Merge | `room query --mode instances-by-object` |
| `gml_room_check_collision_between` | Merge | `room query --mode collision-between` |
| `gml_room_check_collision_map` | Merge | `room query --mode collision-map` |
| `gml_room_find_safe_spawn` | Merge | `room query --mode safe-spawn` |
| `gml_room_find_safe_move` | Merge | `room query --mode safe-move` |
| `gml_room_find_path_space` | Merge | `room query --mode path-space` |
| `gml_room_get_occupancy_grid` | Merge | `room summary --format occupancy` |
| `gml_room_get_ascii_map` | Merge | `room summary --format ascii` |
| `gml_room_get_layout_summary` | Merge | `room summary --format summary` |
| `gml_room_camera_list` | Merge | `room camera list` |
| `gml_room_camera_get` | Merge | `room camera inspect` |
| `gml_room_camera_set_enabled` | Merge | `room camera update --enabled` |
| `gml_room_camera_set_view_rect` | Merge | `room camera update --view-rect` |
| `gml_room_camera_set_port_rect` | Merge | `room camera update --port-rect` |
| `gml_room_camera_set_object_follow` | Merge | `room camera update --follow-object` |
| `gml_room_camera_set_border` | Merge | `room camera update --border` |
| `gml_room_camera_set_speed` | Merge | `room camera update --speed` |
| `gml_room_camera_frame_instances` | Merge | `room camera frame --instances ...` |
| `gml_room_camera_frame_rect` | Merge | `room camera frame --rect ...` |
| `gml_room_camera_validate` | Merge | `room validate --scope camera` |
| `gml_object_list` | Merge | `object list` |
| `gml_object_get` | Merge | `object inspect` |
| `gml_object_get_parent` | Merge | `object inspect --fields parent` |
| `gml_object_set_parent` | Merge | `object update --parent` |
| `gml_object_get_sprite` | Merge | `object inspect --fields sprite` |
| `gml_object_set_sprite` | Merge | `object update --sprite` |
| `gml_object_get_mask` | Merge | `object inspect --fields mask` |
| `gml_object_set_mask` | Merge | `object update --mask` |
| `gml_object_get_events` | Merge | `object event list` |
| `gml_object_get_event_code` | Merge | `object event inspect` |
| `gml_object_set_event_code` | Merge | `object event update --code` |
| `gml_object_add_event` | Keep | `object event add` |
| `gml_object_delete_event` | Keep | `object event delete` |
| `gml_object_has_event` | Merge | `object event inspect` |
| `gml_object_get_physics_settings` | Merge | `object inspect --fields physics` |
| `gml_object_set_physics_settings` | Merge | `object update --physics-settings` |
| `gml_object_validate_events` | Merge | `object validate --scope events` |
| `gml_runner_start` | Merge | `runner start` |
| `gml_runner_stop` | Merge | `runner stop` |
| `gml_runner_restart` | Merge | `runner restart` |
| `gml_runner_pause` | Merge | `runner pause` |
| `gml_runner_resume` | Merge | `runner resume` |
| `gml_runner_get_state` | Merge | `runner status` |
| `gml_runner_get_logs` | Merge | `runner logs` |
| `gml_runner_clear_logs` | Merge | `runner clear-logs` |
| `gml_runner_send_input` | Merge | `runner input` |
| `gml_runner_send_keyboard` | Merge | `runner input --device keyboard` |
| `gml_runner_send_mouse` | Merge | `runner input --device mouse` |
| `gml_runner_send_gamepad` | Merge | `runner input --device gamepad` |
| `gml_runner_capture_screenshot` | Merge | `runner capture screenshot` |
| `gml_runner_capture_video` | Merge | `runner capture video` |
| `gml_runner_set_room` | Merge | `runner room set` |
| `gml_runner_get_current_room` | Merge | `runner room current` |
| `gml_runtime_get_instances` | Merge | `runtime instances` |
| `gml_runtime_get_instance` | Merge | `runtime inspect --scope instance` |
| `gml_runtime_get_instance_variable` | Merge | `runtime get --scope instance` |
| `gml_runtime_set_instance_variable` | Merge | `runtime set --scope instance` |
| `gml_runtime_call_script` | Merge | `runtime call --kind script` |
| `gml_runtime_call_method` | Merge | `runtime call --kind method` |
| `gml_runtime_get_global_variable` | Merge | `runtime get --scope global` |
| `gml_runtime_set_global_variable` | Merge | `runtime set --scope global` |
| `gml_runtime_get_room_state` | Merge | `runtime state --kind room` |
| `gml_runtime_get_camera_state` | Merge | `runtime state --kind camera` |
| `gml_runtime_get_draw_stats` | Merge | `runtime state --kind draw` |
| `gml_runtime_get_audio_state` | Merge | `runtime state --kind audio` |
| `gml_runtime_get_error_log` | Merge | `runtime logs --kind error` |
| `gml_runtime_watch_expression` | Merge | `runtime watch` |
| `gml_test_list` | Merge | `test list` |
| `gml_test_run` | Merge | `test run` |
| `gml_test_run_group` | Merge | `test run --group` |
| `gml_test_get_results` | Merge | `test results` |
| `gml_test_create_case` | Merge | `test case create` |
| `gml_test_update_case` | Merge | `test case update` |
| `gml_replay_record` | Merge | `replay record` |
| `gml_replay_run` | Merge | `replay run` |
| `gml_replay_compare` | Merge | `replay compare` |
| `gml_replay_assert_room` | Merge | `replay assert --kind room` |
| `gml_replay_assert_instance_exists` | Merge | `replay assert --kind instance-exists` |
| `gml_replay_assert_variable` | Merge | `replay assert --kind variable` |
| `gml_replay_assert_no_errors` | Merge | `replay assert --kind no-errors` |
| `gml_profile_start` | Merge | `profile start` |
| `gml_profile_stop` | Merge | `profile stop` |
| `gml_profile_get_fps` | Merge | `profile report --metrics fps` |
| `gml_profile_get_frame_time` | Merge | `profile report --metrics frame-time` |
| `gml_profile_get_memory` | Merge | `profile report --metrics memory` |
| `gml_profile_get_draw_calls` | Merge | `profile report --metrics draw-calls` |
| `gml_profile_get_texture_swaps` | Merge | `profile report --metrics texture-swaps` |
| `gml_profile_get_instance_counts` | Merge | `profile report --metrics instance-counts` |
| `gml_profile_get_room_load_time` | Merge | `profile report --metrics room-load-time` |
| `gml_profile_get_script_timings` | Merge | `profile report --metrics script-timings` |
| `gml_profile_get_gc_pressure` | Merge | `profile report --metrics gc-pressure` |
| `gml_profile_capture_snapshot` | Merge | `profile snapshot` |
| `gml_profile_compare_snapshots` | Merge | `profile compare` |
| `gml_profile_report` | Merge | `profile report` |
| `gml_ui_layout_get` | Merge | `ui inspect --kind layout` |
| `gml_ui_layout_validate` | Merge | `ui validate --checks layout` |
| `gml_ui_anchor_check` | Merge | `ui validate --checks anchors` |
| `gml_ui_text_overflow_check` | Merge | `ui validate --checks text-overflow` |
| `gml_ui_safe_area_check` | Merge | `ui validate --checks safe-area` |
| `gml_ui_create_placeholder_hud` | Merge | `ui scaffold --template placeholder-hud` |
| `gml_ui_create_menu_room` | Merge | `ui scaffold --template menu-room` |
| `gml_ui_place_button` | Merge | `ui scaffold --template button` |
| `gml_ui_place_text` | Merge | `ui scaffold --template text` |
| `gml_ui_preview_resolution` | Merge | `ui preview --resolution ...` |
| `gml_ui_preview_resolutions` | Merge | `ui preview --all-resolutions` |

## Priority Order for AI-Agent v1

| Priority | Recommended first batch |
| --- | --- |
| High | `graph search`, `symbol inspect`, `validate file`, `validate project`, `resource list/find/inspect`, `resource add/remove/rename`, `room list/inspect/update/instance add`, `object inspect/update/event update`, `runner start/stop/status/logs`, `runtime get/set/call/watch` |
| Medium | `resource deps/dependents/audit`, `room preview/query/camera/layer`, `profile`, `test`, `replay`, `ui` |
| Low | `project cache clean`, IDE/open-style flows, anything that only wraps an editor convenience rather than enabling autonomous agent work |

## Notes on Current Implementation

| Area | Current status |
| --- | --- |
| CLI catalog -> MCP tool generation | Already implemented. Current MCP names are prefixed `gmloop_`; target should remove the prefix. |
| Graph tools | Already implemented as `graph index/search/symbol/context/neighbors/usages/doctor/visualize`. |
| Resource mutations | Already implemented in part as `resource add` and `resource remove`, backed by `@gmloop/refactor`. |
| Builtin identifier lookup | Already implemented as `lookup-gml-identifier`, but it only covers the manual snapshot and should become part of `symbol inspect`. |
| Parse/validation | `parse` exists and is useful, but it is a low-level AST tool, not the final AI-facing validation surface. |
| Runner/runtime/profile/test/replay/ui AI control | Not implemented yet as a coherent agent surface. |

