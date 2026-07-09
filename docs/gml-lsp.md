# GML Language Server

GMLoop provides `gmloop-lsp`, a Language Server Protocol server for `.gml` files.

The LSP workspace owns protocol transport, document synchronization, range conversion, and session lifecycle. It delegates domain behavior to the owning workspaces:

- `@gmloop/parser` for parse diagnostics.
- `@gmloop/lint` for lint diagnostics and quick-fix surfaces.
- `@gmloop/format` for document formatting.
- `@gmloop/semantic` for project index facts, symbols, definitions, and references.
- `@gmloop/refactor` for rename/edit safety.

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

For semantic navigation features such as definitions, references, workspace symbols, and rename, open a folder that contains or is nested under a GameMaker `.yyp` project so the semantic project root can be discovered.

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
