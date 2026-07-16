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

Semantic requests acquire one capability-qualified lease from the semantic store and use the indexed query roles on that lease. The lease identity pins the project revision, generation, tier, coverage, validation state, and overlay versions for the duration of the request. Persisted leases query the pinned SQLite generation directly; unsaved-overlay leases expose the same query contract through a session-local in-memory backend. Every request releases its lease when response conversion finishes.

Rename requests use the lease's semantic-owned refactor query role and require the full tier. The LSP does not rebuild a whole-project navigation projection for each hover, definition, reference, completion, symbol, token, or rename request.

Worker analysis currently returns its manifest and revision-qualified snapshot as one semantic result. The adapter publishes disk-backed results to the semantic store and unsaved overlays to bounded session snapshot slots. Build scheduling and publication still live in this workspace today; the target direction is to move that orchestration behind a long-lived semantic project service so the LSP retains only protocol, document, cancellation, workspace-routing, progress, and response-conversion responsibilities.

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

## Hover Behavior

Hover responses describe project symbols and documented runtime built-ins, including functions, properties, symbols, and literals. Constructor-owned instance variables resolve from both bare references and `self`-qualified references inside static methods, and their tooltips link to the defining assignment. Documented callable project symbols, including constructor static methods, expose their description, parameter names and types, and return information. Hovering a user-defined enum, its member declaration, or a resolved member usage includes the complete enum with its members and values. Language keywords such as `function`, `var`, `constructor`, `if`, `else`, and `repeat` are syntax rather than inspectable symbols, so hovering them returns no tooltip.

## Background Semantic Indexing

The LSP server uses a dual-tier semantic analysis orchestration strategy to ensure editor responsiveness while guaranteeing project-wide semantic accuracy:

1. **Active-File Prioritization (Tier 1)**: Any interactive event (opening a document, editing content, saving, or closing) immediately triggers a fast **Definitions Tier** build for the project. This is prioritized so that completions, hover metadata, and definition lookups are available with minimal delay.
2. **Background Project Upgrade (Tier 2)**: Once the lightweight Definitions Tier finishes, the server automatically schedules and continues a **Full Project Tier** build asynchronously in the background. This indexes all files and relationships (e.g., cross-file references, renames, overrides) without blocking the event loop or interactive requests.
3. **Graceful Interrupt and Resume**: If a new file operation or edit occurs while the background full build is active, the background build is aborted immediately to free resources. Once the new definitions pass completes, background indexing is rescheduled for the new revision. Scheduled background builds are version-qualified so that stale requests (invalidated by subsequent edits or file changes) exit immediately without interrupting active builds.

## Launching and Communication Transport

The language server is started via the CLI using:

```sh
gmloop lsp
```

To ensure seamless integration with LSP/MCP clients (such as `lsp-mcp-server`) and editor extensions, the server does not require command-line options like `--stdio`. Instead, it defaults to standard I/O (stdio) transport internally by explicitly wiring `process.stdin` and `process.stdout` into the LSP connection.
