# Codex `build-lint-test` agent

The `build-lint-test` agent is a strict internal GMLoop repository build, lint,
and test reporter that the orchestrator delegates one exact bounded shell
command to. Repository build, lint, and tests run through the assigned `pnpm`
command, not GMLoop MCP. The agent returns exact verbatim failure excerpts; it
does not fix anything, expand scope, or invent commands.

It is configured in
[`.codex/agents/build-lint-test.toml`](../.codex/agents/build-lint-test.toml)
and registered in [`.codex/config.toml`](../.codex/config.toml) under
`[agents.build-lint-test]`.

## Purpose

- Run one of the safe repository commands (`pnpm run build:ts`,
  `pnpm run build`, `pnpm run lint:quiet`, `pnpm run test:quiet`,
  `pnpm run test:compiled`, or `pnpm run test`) exactly as the
  orchestrator assigns it.
- Use no MCP tools. Zero MCP servers are reachable because every inherited MCP
  table is explicitly disabled.
- Report only the command, its exit status, and exact verbatim stdout/stderr
  failure excerpts (including file paths, line numbers, and rule identifiers)
  already present in the output. Warnings are omitted unless the orchestrator
  explicitly requests them. When status is requested after success, return
  only a compact no-failures line.

### Intentional shell path for build and tests

Repository build, lint, and tests always go through the assigned shell
command. The agent never uses GMLoop MCP, the GMLoop CLI, the runtime wrapper,
the formatter, the refactor pipeline, watchers, hot-reload, or the GameMaker
runtime to run them; the orchestrator-assigned `pnpm run` command is the single
authoritative entry point.

### Generated-artifact scope

`workspace-write` access exists only for generated artifacts from the assigned
`pnpm run` command, such as normal `dist/`, cache, and test artifact
directories. It is not permission to edit source, tests, configuration,
documentation, agents, or fixtures. The generated artifacts are disposable.

### Network restriction

Network access is disabled at the sandbox boundary. The agent cannot run
`pnpm`/`npm`/`yarn install`, `add`, `remove`, or `update`; cannot run
`curl`, `wget`, `fetch`, or any other HTTP client; and cannot reach
external registries, telemetry endpoints, or the GitHub API. The
agent's responsibility is purely local: read what the assigned command
emitted and report it back.

## Configuration contract

| Setting | Value |
| --- | --- |
| `name` | `"build-lint-test"` |
| `description` | Strict GMLoop build, lint, and test reporter that only runs commands explicitly assigned by the orchestrator and returns exact failure excerpts (warnings only when requested). |
| `model` | `"gpt-5.4-mini"` |
| `model_reasoning_effort` | `"medium"` |
| `sandbox_mode` | `"workspace-write"` |
| `[sandbox_workspace_write].network_access` | `false` |
| `model_provider` | *(unset — do not set, do not use MiniMax)* |
| MCP servers | None enabled; every inherited MCP table is disabled |

`workspace-write` access exists solely so the assigned `pnpm run` build,
lint, test, and reporter commands can populate the normal `dist/`, cache,
and test artifact directories. Network access is disabled at the sandbox
boundary so the agent cannot fetch dependencies, contact registries, or
reach any external service.

## MCP server isolation

The agent has zero reachable MCP servers and no MCP tools. Custom agent
configuration layers can inherit parent MCP server entries, so the role keeps
explicit fail-closed tables for `gmloop`, `gm-cli`, `playwright`, `lsp`,
`node_repl`, and `computer-use`. Every table uses `command = "false"`,
`args = []`, and `enabled = false`; no table has an `enabled_tools` allowlist.

## Explicit prohibitions

- **No source, test, doc, config, or agent edits.** The agent never
  edits, creates, renames, chmods, or deletes any file. It does not use
  apply_patch, write_to_file, edit_file, or any patch-style tool.
- **No git activity.** The agent does not run git, stage, commit, push,
  branch, rebase, or open pull requests.
- **No dependency or network activity.** The agent does not install,
  add, remove, or upgrade dependencies; it does not run pnpm/npm/yarn
  install/add/remove/update; it does not use curl, wget, fetch, or any
  HTTP client. Network is disabled at the sandbox boundary.
- **No formatter, fix, refactor, watch, runtime, or browser actions.**
  Formatters, linters with `--write`/`--fix`, codemods, watchers,
  hot-reload, runtime inspection, browser automation, and all MCP actions are
  off-limits for this agent.
- **No arbitrary shell commands.** The only shell activity permitted is
  the single command the orchestrator assigned for the current turn,
  plus reading its output. The agent does not chain extra commands or
  pipe through extra tooling.
- **No spawning additional agents.** The agent reports back to the
  orchestrator; it does not fan out further.

## Reporting contract — exact-output-only

When the orchestrator delegates a command, the agent returns:

1. The command or tool name.
2. The exit/result status, including the non-zero exit code when the
   command failed.
3. The exact stdout/stderr failure excerpts, with file paths, line
   numbers, and rule identifiers quoted verbatim from the output.

This is exact-output-only reporting: the agent never summarizes,
paraphrases, hedges, or adds background to the output, never proposes
fixes, and never lists next steps. Warnings are omitted unless the
orchestrator explicitly asks for them. On success the agent returns only
a compact no-failures status (for example: `pnpm run build:ts: exit 0,
no failures`). On failure the agent reports the verbatim excerpts and
stops; it does not rerun or retry.
