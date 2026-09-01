# GML Language Server

GMLoop provides `gmloop-lsp`, a Language Server Protocol server for `.gml` files.

The LSP workspace owns protocol transport, document synchronization, range conversion, and session lifecycle. It delegates domain behavior to the owning workspaces:

- `@gmloop/parser` for parse diagnostics.
- `@gmloop/lint` for lint diagnostics and quick-fix surfaces.
- `@gmloop/format` for document formatting.
- `@gmloop/semantic` for project index facts, symbols, definitions, and references.
- `@gmloop/refactor` for rename/edit safety.

For each semantic request, the server acquires a capability-qualified lease that pins one project revision, generation, tier, coverage summary, validation state, and set of overlay versions. It reads through the lease's indexed semantic query roles and releases the lease after converting the result to LSP data. Persisted requests query the pinned SQLite generation directly; unsaved buffers use the same contract through session-local query state. This avoids rebuilding a whole-project navigation view for each request.

The current LSP still coordinates definitions/full worker builds and semantic publication. The architectural direction is to place that orchestration behind the semantic project service, leaving the LSP responsible for protocol transport, document synchronization, workspace routing, cancellation, progress, and response conversion.

## Editor Usage

Build the workspace, then run GMLoop's LSP server:

```sh
# Start the LSP server over stdio
gmloop lsp
```

The server explicitly wires standard input and standard output (`process.stdin` / `process.stdout`) to speak JSON-RPC over stdio by default, without requiring any command-line flags. It targets `.gml` files only.

## VSCode Usage

GMLoop provides a first-party VSCode extension package in `src/vscode`. The extension registers `.gml` files as the `gml` language and starts the existing stdio server with:

```sh
gmloop lsp
```

The extension contributes:

- `gmloop.serverPath` - path or command name for the GMLoop CLI executable. It defaults to `gmloop`; the extension always appends the fixed `lsp` argument.
- `GMLoop: Restart Language Server`
- `GMLoop: Show Language Server Output`

Lint fixes are exposed exclusively through standard LSP code actions. Editors can request `quickfix` for one current lint diagnostic or `source.fixAll` for all safe, single-file fixes produced by `@gmloop/lint`. The VSCode client does not register a custom lint-fix command or JSON-RPC request.

For semantic navigation features such as definitions, references, workspace symbols, and rename, open a folder that contains or is nested under a GameMaker `.yyp` project so the semantic project root can be discovered.

Hover distinguishes inspectable symbols from language syntax. Project symbols and documented runtime built-ins such as functions, `sprite_index`, and `visible` provide tooltips; keywords such as `function`, `var`, `constructor`, `if`, `else`, and `repeat` do not. Constructor-owned instance variables resolve from both bare references and `self`-qualified references inside static methods, and their tooltips link to the defining assignment. For documented callable project symbols, including constructor static methods, the tooltip includes the description, parameter names and types, and return information.

Comments, strings, and function-documentation contents such as `@desc`, `@param`, and `@returns` do not produce GMLoop hover results. VSCode can still merge a hover from another installed extension; in particular, GitHub Pull Requests treats raw `@name` text in comments as GitHub user mentions. Disable that extension for the workspace if those external profile cards conflict with GML documentation tags.

Game projects initialized with `gmloop agent-pack init --vscode` receive project-local `.vscode/settings.json` and `.vscode/extensions.json` files for this setup. The command also makes a best-effort attempt to install the GMLoop VSCode extension through the `code` CLI.

Before Marketplace publishing, the installable VSCode extension artifact is a local `.vsix`:

```sh
pnpm run package:vscode
code --install-extension src/vscode/dist/gmloop-0.0.1.vsix
```

The generated VSIX contains the VSCode client and its runtime `vscode-languageclient` dependency. It does not bundle the language server itself; VSCode still launches the configured `gmloop.serverPath` with the fixed `lsp` argument.

### Active LSP Development In VSCode

For active LSP development, install the VSIX once, keep `gmloop.serverPath` pointed at your local compiled CLI, run `pnpm run build:ts`, then restart the language server in VSCode.

Use this loop when editing the language server or the workspaces it delegates to:

```sh
pnpm run build:ts
```

Then run this command from VSCode's Command Palette:

```text
GMLoop: Restart Language Server
```

The VSCode extension is a thin client and does not bundle the LSP implementation, so rebuilding and restarting the server is enough for normal LSP changes. Rebuild and reinstall the VSIX only when the VSCode extension workspace itself changes.

The extension does not currently auto-refresh after GMLoop code changes. Automatic refresh would need a development-only watcher that rebuilds the repository and asks the VSCode client to restart the language server.

## Using With `lsp-mcp-server`

`lsp-mcp-server` is an MCP bridge. It should launch `gmloop-lsp` as the language server instead of GMLoop duplicating LSP tools inside the GMLoop MCP server.

Example MCP configuration:

```json
{
    "mcpServers": {
        "lsp": {
            "command": "lsp-mcp-server",
            "env": {
                "LSP_LOG_LEVEL": "info"
            }
        }
    }
}
```

Configure the bridge's language-server catalog in `.lsp-mcp.json` or `lsp-mcp.json` so `.gml` files use:

```json
{
    "servers": [
        {
            "id": "gml",
            "extensions": [".gml"],
            "languageIds": ["gml"],
            "command": "gmloop-lsp",
            "args": []
        }
    ]
}
```

GMLoop MCP and GMLoop LSP are companion surfaces: MCP exposes agent workflows, while LSP exposes editor-style code intelligence that MCP bridges can consume.
