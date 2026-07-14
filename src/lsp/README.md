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

Rename requests consume the current immutable semantic snapshot through semantic-owned refactor query roles. When Tier 1 is upgraded to Tier 2, the LSP replaces the navigation view and snapshot together, so a request cannot combine declaration-only facts with full rename data.

Worker analysis returns its manifest and revision-qualified snapshot as one semantic result. The adapter publishes disk-backed results to the semantic store and unsaved overlays to its bounded session snapshot slots; it does not reconstruct snapshots from the LSP navigation projection.

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

## Launching and Communication Transport

The language server is started via the CLI using:

```sh
gmloop lsp
```

To ensure seamless integration with LSP/MCP clients (such as `lsp-mcp-server`) and editor extensions, the server does not require command-line options like `--stdio`. Instead, it defaults to standard I/O (stdio) transport internally by explicitly wiring `process.stdin` and `process.stdout` into the LSP connection.

## TODO
- **BUG**: For the LSP/semantic/VSCode extension/syntax-highlighting, there are some misses in the semantic highlighting: macros are not highlighted, *some* enum-members (even in the same enum declaration) are not highlighted, some/most function arguments are not highlighted, uses of an enum member are not highlighted, local variables are not highlighted, static-struct members/variables are not highlighted (ex. `get_debug_text` in this snippet: `static get_debug_text = function () {...`)
- **FEAT**: When hovering over a function/method parameter, the hover tooltip should show the parameter's type and description (if documented) in addition to its name. For example, hovering over `target` in this snippet:
  ```gml
  /// @desc Set a new top priority target
  /// @param {Struct.AbstractTarget} target The new top-priority target for the AI to consider
  /// @returns {undefined}
  static add_priority_target = function (target) {
    targeting.add_priority_target(target);
  };
  ```
  Currently shows "target\nparameter - local:scope-6:target\ndefined in scripts/aicontroller/aicontroller.gml" but should include the type and description from the doc-comment, like.
