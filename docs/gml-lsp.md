# GML Language Server

GMLoop provides `gmloop-lsp`, a Language Server Protocol server for `.gml` files.

The LSP workspace owns protocol transport, document synchronization, range conversion, and session lifecycle. It delegates domain behavior to the owning workspaces:

- `@gmloop/parser` for parse diagnostics.
- `@gmloop/lint` for lint diagnostics and quick-fix surfaces.
- `@gmloop/format` for document formatting.
- `@gmloop/semantic` for project index facts, symbols, definitions, and references.
- `@gmloop/refactor` for rename/edit safety.

## Editor Usage

Build the workspace, then point an editor LSP client at the binary:

```sh
pnpm --filter @gmloop/lsp run build:types
gmloop-lsp
```

The server speaks JSON-RPC over stdio and targets `.gml` files only.

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

Configure the bridge's language-server catalog so `.gml` files use:

```json
{
  "gml": {
    "command": "gmloop-lsp",
    "args": [],
    "extensions": [".gml"]
  }
}
```

GMLoop MCP and GMLoop LSP are companion surfaces: MCP exposes agent workflows, while LSP exposes editor-style code intelligence that MCP bridges can consume.
