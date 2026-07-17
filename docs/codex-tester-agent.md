# Codex `tester` agent

The `tester` agent is a read-only GameMaker runtime and browser tester that the
orchestrator delegates bounded verification goals to. It is configured in
`.codex/agents/tester.toml` and registered in `.codex/config.toml` under
`[agents.tester]`.

## Purpose

- Drive a live GameMaker build without mutating any project asset,
  configuration, or runtime wrapper.
- Connect the GMLoop live-reload session to the running game and use Playwright
  to navigate, interact with, and screenshot the page.
- Collect browser console and network evidence alongside GMLoop runner and
  runtime evidence, then report an exact success or failure plus the precise
  next action for the orchestrator.

## Configuration contract

| Setting | Value |
| --- | --- |
| `name` | `"tester"` |
| `description` | Read-only GameMaker runtime and browser tester directed by the orchestrator; drives GMLoop live reload, gm-cli reads, and Playwright interactions only through the allowlisted MCP tools. |
| `model` | `"gpt-5.6-luna"` |
| `model_reasoning_effort` | `"max"` |
| `sandbox_mode` | `"read-only"` |
| `model_provider` | *(unset — do not set, do not use MiniMax)* |

The agent registers through the `[agents.tester]` block in
`.codex/config.toml`, pointing at `./agents/tester.toml`.

## MCP server allowlists

Custom-agent allowlists use server-local tool names under
`[mcp_servers.<server>].enabled_tools`. Each entry is **the only tool** the
tester may call on that server.

### `gmloop` — runtime and live reload

- `gmloop_project_inspect`, `gmloop_project_validate`,
  `gmloop_live_reload_session`, `gmloop_live_reload_wait_for_patch`,
  `gmloop_runner_lifecycle`, `gmloop_runner_logs`,
  `gmloop_runner_room_current`, `gmloop_runner_status`,
  `gmloop_runtime_inspect`, `gmloop_runtime_instances`,
  `gmloop_runtime_logs`, `gmloop_runtime_state`.

### `gm-cli` — read-only project / resource / room context

- `status`, `resource_list`, `resource_info`, `room_list`,
  `room_item_list`, `room_layer_list`.

### `playwright` — browser interaction and observation

- `browser_navigate`, `browser_tabs`, `browser_snapshot`,
  `browser_take_screenshot`, `browser_click`, `browser_type`,
  `browser_fill_form`, `browser_press_key`, `browser_wait_for`,
  `browser_console_messages`, `browser_network_requests`,
  `browser_network_request`, `browser_find`, `browser_hover`,
  `browser_select_option`, `browser_drag`, `browser_handle_dialog`,
  `browser_resize`, `browser_close`.

The agent also declares `lsp`, `node_repl`, and `computer-use` as disabled
servers. Their `command = "false"` entries satisfy Codex's stdio transport
schema while keeping those inherited surfaces fail-closed and unreachable.
The three enabled server tables repeat their stdio commands, arguments, and
the GMLoop internal-tool environment so the custom agent file is
self-contained when Codex deserializes it.

## Explicit prohibitions

- **No shell or code execution.** The tester never uses shell, terminal,
  exec, or any file-read/write tool. It only speaks through the MCP
  allowlists above.
- **No GMLoop or gm-cli mutation tools.** Tools that create, modify,
  delete, stage, commit, push, or otherwise mutate project assets or
  configuration are off-limits. The allowlists intentionally omit every
  write-side tool.
- **No unsafe Playwright primitives.** `browser_evaluate` and
  `browser_run_code_unsafe` are not enabled; arbitrary in-page code is
  unreachable from this agent.
- **No inherited non-target MCP servers.** `lsp`, `node_repl`, and
  `computer-use` are explicitly declared with `enabled = false` in the
  tester config so the only MCP surfaces the tester can reach are
  `gmloop`, `gm-cli`, and `playwright`.
- **No spawning additional agents.** The tester reports back to the
  orchestrator; it does not fan out further.

## Reporting contract

When the orchestrator delegates a goal, the tester returns:

1. The exact success or failure of the goal.
2. The evidence it collected: tool calls made, browser console and
   network observations, GMLoop runner and runtime snapshots, Playwright
   screenshots or DOM snapshots as relevant.
3. The precise next action the orchestrator should take.
