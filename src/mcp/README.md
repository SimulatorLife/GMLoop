# `@gmloop/mcp`

`@gmloop/mcp` is the planned MCP server workspace for exposing GMLoop CLI behavior to LLM, AI, and agent clients.

The current scaffold intentionally contains only the package framework, public namespace, and stdio server entrypoint. Tool registration should be implemented by deriving MCP tools from the CLI command catalog, not by redefining commands in this workspace.

## Full Implementation Plan

### Summary

- Add a new workspace package `src/mcp` named `@gmloop/mcp`.
- Implement a stdio-only MCP server that dynamically registers one MCP tool per real CLI command.
- Make the CLI's registered Commander commands the single source of truth for MCP tools, tool descriptions, options, and positional arguments.
- Do not add MCP-only command behavior, raw argv escape hatches, legacy aliases, or duplicate command definitions. New MCP tools/options must appear only by adding CLI commands/options.
- Include graph-index resources backed by `@gmloop/semantic`, including graph overview, node, context, and neighbors resources.

### Key Changes

- Treat the CLI workspace as the owner of the canonical command/tool surface:
    - It is in scope to update and improve `@gmloop/cli`'s public API so it exposes commands, options, argument metadata, command documentation, and execution helpers in a standard, intentional shape for MCP consumption.
    - The MCP workspace should consume only that public CLI API, not private CLI files, Commander internals, duplicated registries, or command-specific redefinitions.
    - The ideal target is a small, typed, stable CLI facade that can serve both the CLI binary and MCP workspace from the same registered command definitions.
- Refactor the CLI so importing `@gmloop/cli` is side-effect free and its public API cleanly exposes the command catalog MCP needs:
    - Move executable startup into a dedicated CLI main entrypoint.
    - Keep the package public root as an importable API surface.
    - Update the CLI `bin` target to the new main entrypoint.
    - Add or improve first-class CLI public exports for command discovery and execution, rather than requiring `@gmloop/mcp` to import CLI internals or reconstruct command definitions.
- Extend the CLI command manager/catalog to expose registered command metadata through a stable, documented public API:
    - Command name, description, usage/help text.
    - Positional arguments from Commander metadata.
    - Visible options from Commander metadata, excluding hidden help/alias options.
    - Runner support that lets another workspace invoke the same registered command logic while capturing `stdout`, `stderr`, and `exitCode`.
    - Public types for command metadata and execution results so MCP schema generation can depend on explicit contracts instead of Commander implementation details.
- Remove reliance on the hardcoded/stale command-name list for command discovery. The current list includes `performance` without a registered command; the new catalog should derive names from registered commands and remove that obsolete path.
- Add `@gmloop/mcp` with:
    - `package.json`, `index.ts`, `src/index.ts`, `src/main.ts`, `tsconfig.json`, and `test/`.
    - A `gmloop-mcp` bin using `StdioServerTransport`.
    - Direct workspace import via `import { CLI } from "@gmloop/cli"`.
    - `@modelcontextprotocol/sdk` and `zod` as direct dependencies.

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
