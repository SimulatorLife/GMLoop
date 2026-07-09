# LSP

## Purpose

This workspace/module (`src/lsp`) contains the GML language server implementation, which exposes GameMakerLanguage project intelligence through standard Language Server Protocol capabilities for use through `lsp-mcp-server`.

It is not an agent framework, MCP server, custom refactor tool, project manager, build runner, or IDE replacement.

Expose behavior through normal LSP requests and responses only. Do not implement custom MCP tools, agent-specific commands, bespoke APIs, or extra language-server features outside that tool surface.

All externally reachable behavior must flow through the LSP capabilities used by `lsp-mcp-server`. If a feature cannot be reached through an existing lsp-mcp-server tool, it is out of scope of this module.

## Architecture

The server should be a thin LSP adapter over the other reusable GMLoop systems/modules/workspaces:

- The GML parser handles tolerant parsing/tokenization.
- The project index understands GameMaker resources and file relationships.
- The analyzer produces symbols, references, scopes, diagnostics, and semantic facts.
- The refactor layer produces safe code edits.
- The language server only translates those results into LSP responses.

Keep GML business logic out of the protocol layer where possible.

## Agent Compatibility

Agents should use the server exactly like editors do: through LSP.

The server should not care whether the caller is an editor, CLI, bridge, or AI agent.

## Integration Rule

External tools may launch or configure the server, but they must not change its core API or require tool-specific behavior.

Tool-specific setup belongs outside the language server.

VSCode integration lives in the separate `@gmloop/vscode` workspace. That extension registers `.gml` files with VSCode and launches this server through `gmloop lsp`; this workspace remains the editor-agnostic LSP server implementation.

## Quality Bar

A feature is complete only when it:

- Works on real GameMaker project structure.
- Handles unsaved changes.
- Handles incomplete code.
- Returns stable ranges and URIs.
- Has fixture tests.
- Fails gracefully.
- Does not require a specific editor or agent tool.
- Is reachable through the approved `lsp-mcp-server` tool surface.

The language server should be boring, standard, constrained, agent-agnostic, and small.

Most intelligence should live in reusable GML systems; the server should only expose that intelligence through the standard LSP capabilities reachable by `lsp-mcp-server`.

## Launching and Communication Transport

The language server is started via the CLI using:

```sh
gmloop lsp
```

To ensure seamless integration with LSP/MCP clients (such as `lsp-mcp-server`) and editor extensions, the server does not require command-line options like `--stdio`. Instead, it defaults to standard I/O (stdio) transport internally by explicitly wiring `process.stdin` and `process.stdout` into the LSP connection.
