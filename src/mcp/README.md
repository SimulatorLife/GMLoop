# `@gmloop/mcp`

`@gmloop/mcp` exposes GMLoop CLI behavior to LLM, AI, and agent clients.

Tool registration is derived from the CLI command catalog rather than redefined in this workspace. Adding, removing, or renaming an agent-facing command tool starts with the GMLoop CLI command definition, not MCP-local business logic.

MCP is a stable local transport for GameMaker-specific tools, context, and
evidence. It does not own model selection, agent scheduling, task routing,
permissions, approvals, retries, memory, budgets, queues, or long-running
workflow state. Those responsibilities remain with external agent
coordinators. Framework-specific integrations must be optional adapters over
the CLI-derived MCP contract, never core dependencies or MCP-only behavior.

`@gmloop/mcp` also must not duplicate official GameMaker CLI behavior. When
`gm-cli` or its ResourceTool MCP server already owns a project/resource/build
operation, agents may use that official MCP server directly alongside GMLoop.
Add a GMLoop MCP tool only when the underlying CLI command contributes
GMLoop-owned value such as semantic graph context, validation, lint/format/
refactor orchestration, hot reload, deterministic fixtures, or task evidence.
MCP resources may surface read-only graph/context data, but command-like writes
must stay CLI-derived.

## Contract

### Summary

- Make the CLI's registered Commander commands the single source of truth for MCP tools, tool descriptions, options, and positional arguments.
- Do not add MCP-only command behavior, raw argv escape hatches, legacy aliases, or duplicate command definitions. New MCP tools/options must appear only by adding CLI commands/options.
- Keep graph-index resources backed by `@gmloop/semantic`, including graph overview, node, context, and neighbors resources.
- Treat official `gm-cli` and ResourceTool behavior as a companion MCP surface, not as something this workspace mirrors.

### CLI / MCP Boundary

- Treat the CLI workspace as the owner of the canonical command/tool surface:
    - It is in scope to update and improve `@gmloop/cli`'s public API so it exposes commands, options, argument metadata, command documentation, and execution helpers in a standard, intentional shape for MCP consumption.
    - The MCP workspace should consume only that public CLI API, not private CLI files, Commander internals, duplicated registries, or command-specific redefinitions.
    - The ideal target is a small, typed, stable CLI facade that can serve both the CLI binary and MCP workspace from the same registered command definitions.
- Extend the CLI command manager/catalog to expose registered command metadata through a stable, documented public API:
    - Command name, description, usage/help text.
    - Positional arguments from Commander metadata.
    - Visible options from Commander metadata, excluding hidden help/alias options.
    - Runner support that lets another workspace invoke the same registered command logic while capturing `stdout`, `stderr`, and `exitCode`.
    - Public types for command metadata and execution results so MCP schema generation can depend on explicit contracts instead of Commander implementation details.
- For official GameMaker project/resource/build capabilities:
    - Expect agents to use `gm-cli` / ResourceTool MCP directly when that tool is the right operation.
    - Expose a GMLoop command only when the CLI layer adds GMLoop-owned context, validation, hot-reload, refactor, or evidence behavior.
    - Do not register separate MCP tools that call ResourceTool directly unless they are read-only resources or explicitly remain under the `gmloop gm-cli` integration surface.

### MCP Tool Behavior

- Generate tool names deterministically as `gmloop_<command-name-with-dashes-converted-to-underscores>`, for example `gmloop_format`, `gmloop_lint`, and `gmloop_refactor`.
- Graph leaf commands follow the same pattern, such as `gmloop_graph_index`, `gmloop_graph_search`, `gmloop_graph_context`, and `gmloop_graph_usages`.
- Generate each tool's input schema from Commander metadata:
    - Include `cwd` as an MCP-only execution context field.
    - Include positional arguments by declared Commander argument name and order.
    - Include visible CLI options by Commander `attributeName()`.
    - Use booleans for boolean/negated flags, strings for value options, arrays for variadic options, and choices where Commander exposes choices.
    - Do not apply schema defaults that duplicate CLI defaults; let the CLI remain authoritative.
- Convert MCP input back into CLI argv and invoke the CLI runner:
    - Always include the command name explicitly, including `format`.
    - Append positional arguments in Commander order.
    - Emit long option flags from Commander metadata.
    - Omit unset fields so Commander defaulting and validation stay in one place.
- Return structured MCP output with:
    - `command`, `argv`, `cwd`, `exitCode`, `stdout`, and `stderr`.
    - Text content containing a concise command result summary.
    - `isError: true` when the CLI exits nonzero.
- Serialize CLI invocations inside the MCP server if the chosen runner mutates process-level state such as `cwd`, env, or output streams.

### MCP Resources

- Register read-only graph resources backed by the semantic graph-index query APIs.
- v1 resource URIs include:
  - `gm://graph/overview`
  - `gm://graph/project/overview`
  - `gm://graph/toolset/overview`
  - `gm://node/<id>`
  - `gm://context/<id>?depth=2`
  - `gm://neighbors/<id>?depth=2`

### Tests

- CLI tests:
    - Importing `@gmloop/cli` does not execute the CLI.
    - The command catalog lists only registered commands and excludes stale `performance`.
    - Catalog metadata includes representative options/arguments for `format`, `lint`, `refactor`, and `watch-status`.
    - Existing help alias behavior still works through the new registered-command discovery path.
- MCP tests:
    - Generated tools match the CLI catalog without hand-authored per-command registration.
    - Tool schema generation handles boolean, negated, string, choices, and variadic fields.
    - Tool invocation converts inputs to argv correctly.
    - Nonzero CLI results return `isError: true` with captured stderr.
    - Adding a fake CLI command in a test catalog automatically produces a new MCP tool without touching MCP-specific registration code.
- Validation commands:
    - `pnpm --filter @gmloop/cli run build:types`
    - `pnpm --filter @gmloop/mcp run build:types`
    - `pnpm run test:cli`
    - `pnpm run test:mcp`
    - `pnpm run build:ts`

### Assumptions

- Package name is `@gmloop/mcp`, per the current request, not the older docs TODO name `@gmloop/mcp-server`.
- v1 supports stdio only. This follows the selected direction and the MCP TypeScript SDK's stdio transport for local process-spawned MCP clients.
- The MCP implementation uses `registerTool` from the official TypeScript SDK and generates tool schemas from CLI metadata rather than maintaining MCP-local command definitions.

## TODO
- Make a GML LSP so that it can be directly consumed by agents
