# Codex `build-lint-test` agent

The `build-lint-test` agent is a strict GMLoop build, lint, and test reporter
that the orchestrator delegates a single bounded command to. It runs the
command and returns exact failure excerpts; it does not fix anything, expand
scope, or invent commands.

It is configured in
[`.codex/agents/build-lint-test.toml`](../.codex/agents/build-lint-test.toml)
and registered in [`.codex/config.toml`](../.codex/config.toml) under
`[agents.build-lint-test]`.

## Purpose

- Run one of the safe repository commands (`pnpm run build:ts`,
  `pnpm run build`, `pnpm run lint:quiet`, `pnpm run test:quiet`,
  `pnpm run test:compiled`, or `pnpm run test`) exactly as the
  orchestrator assigns it.
- Optionally call the `gmloop_lint` MCP tool without its write option when
  the orchestrator asks for an MCP lint read. Repository build and tests
  always go through the shell, never through any GMLoop tool.
- Report the command or tool name, its exit/result status, and the exact
  stdout/stderr failure excerpts (file paths, line numbers, rule
  identifiers) that are already present in the output. Warnings are
  omitted unless the orchestrator explicitly requests them.

### Intentional shell path for build and tests

Repository build and tests always go through the shell. The agent never
uses a GMLoop tool, the GMLoop CLI, the runtime wrapper, the formatter,
the refactor pipeline, watchers, hot-reload, or the GameMaker runtime to
run them; the orchestrator-assigned `pnpm run` command in the shell is
the single authoritative entry point. This keeps lint MCP reads
(allowing only `gmloop_lint`) and shell-driven build/test runs strictly
separated.

### Lint MCP limitation

When the orchestrator explicitly assigns `gmloop_lint`, the agent must
call it without `--write`. The lint MCP surface exposes only the
diagnostic `gmloop_lint` tool — never any write-side tool — so the
agent cannot mutate source, fixtures, or configuration via the MCP
surface. Any content rewrite is the orchestrator's and the worker's
responsibility, not this reporter's.

### Generated-artifact scope

`workspace-write` access exists solely so the assigned `pnpm run` build,
lint, test, and reporter commands can populate the normal `dist/`,
`tsconfig.*.tsbuildinfo`, cache, and test artifact directories. The
agent never writes outside that generated-artifact scope, never edits
source, tests, configuration, documentation, agents, or fixtures, and
never touches any user-visible file. The generated artifacts are
disposable; the role's `[sandbox_workspace_write]` settings intentionally
constrain that writes are limited to the workspace paths the orchestrator
expects the assigned commands to need.

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

`workspace-write` access exists solely so the assigned `pnpm run` build,
lint, test, and reporter commands can populate the normal `dist/`, cache,
and test artifact directories. Network access is disabled at the sandbox
boundary so the agent cannot fetch dependencies, contact registries, or
reach any external service.

## MCP server allowlists

Custom-agent allowlists use server-local tool names under
`[mcp_servers.<server>].enabled_tools`. Each entry is **the only tool** the
build-lint-test agent may call on that server.

### `gmloop` — lint read only

- `gmloop_lint`. The agent must call it without `--write` (i.e., the lint
  MCP tool is used for diagnostics, never for content rewrites).
  Repository build and tests always run through the shell, not through
  any GMLoop tool.

### Disabled servers

The agent declares `gm-cli`, `playwright`, `lsp`, `node_repl`, and
`computer-use` as disabled servers. Each table uses
`command = "false"` and `args = []` so Codex's stdio transport schema is
still satisfied, the inherited surfaces remain fail-closed, and the agent
can reach only the `gmloop` MCP server (and only the `gmloop_lint` tool).

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
  hot-reload, runtime inspection, and browser automation are off-limits
  for this agent.
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
