# GMLoop VSCode Extension

The extension registers `.gml` files with GMLoop's shared syntax-highlighting inventory and a `source.gml`
TextMate grammar. Its editor configuration for comments, accessors, strings, regions, indentation, and word
boundaries is adapted from [Stitch's GML language support](https://github.com/bscotch/stitch/tree/develop/packages/vscode/languages),
with GMLoop's ANTLR lexer grammar treated as the authoritative syntax contract.

This workspace contains the first-party VSCode client for GMLoop's GameMaker Language server. It registers `.gml` files as the `gml` language and starts the existing GMLoop LSP server with:

```sh
gmloop lsp
```

## Syntax And Semantic Highlighting

GMLoop combines a TextMate grammar with semantic tokens from the language server. The grammar colors syntax
immediately, including declarations, constructor types and parameters, enums, macros, member calls, JSDoc, and
Unicode identifiers. Once the server has analyzed the document, semantic tokens distinguish built-ins, functions,
constructors, parameters, local/global/instance variables, properties, enums, macros, and project resources.

Standalone `.gml` files receive declaration and bundled GameMaker built-in highlighting. Opening a folder containing
a `.yyp` project adds project-aware definition/reference and resource classification. Unsaved document text is used
when semantic tokens are recomputed.

To inspect the scope and semantic token applied at the cursor, run VSCode's `Developer: Inspect Editor Tokens and
Scopes` command. Color choices remain controlled by the active VSCode theme; GMLoop contributes standard TextMate
scopes and standard LSP semantic token types rather than installing a custom theme.

## Prerequisites

- Node.js `>=22.5.0`
- `pnpm`
- VSCode
- GMLoop dependencies installed from the repository root:

```sh
pnpm install
```

The repository postinstall links the local `gmloop` CLI. If `gmloop` is not on your PATH, set `gmloop.serverPath` in VSCode to the absolute path for the compiled CLI entrypoint, for example:

```json
{
  "gmloop.serverPath": "/Users/henrykirk/GMLoop/src/cli/dist/index.js"
}
```

The extension always appends the fixed `lsp` argument, so do not include `lsp` in `gmloop.serverPath`.

## Build The Extension

From the repository root:

```sh
pnpm --filter @gmloop/vscode run build:types
```

This emits the VSCode extension entrypoint to:

```text
src/vscode/dist/src/extension.js
```

## Package An Installable VSIX

For local installation or distribution before Marketplace publishing, build a `.vsix` package:

```sh
pnpm run package:vscode
```

This builds the TypeScript entrypoint, creates a VSCode-compatible staged manifest with extension id `gmloop.gmloop`, installs the extension runtime dependencies into that staging folder, and writes:

```text
src/vscode/dist/gmloop-0.0.1.vsix
```

Install that package into VSCode with:

```sh
code --install-extension src/vscode/dist/gmloop-0.0.1.vsix
```

After installing, open a GameMaker project folder and ensure `gmloop` is on PATH, or set `gmloop.serverPath` to the compiled CLI entrypoint.

## Run In VSCode From Source

1. Open the GMLoop repository folder in VSCode.
2. Build the extension:

   ```sh
   pnpm --filter @gmloop/vscode run build:types
   ```

3. Open VSCode's Run and Debug view.
4. Create or use an extension-host launch configuration that points at this extension workspace.
5. Start an Extension Development Host.
6. In the Extension Development Host, open a GameMaker project folder containing a `.yyp` file.
7. Open a `.gml` file.

When the `.gml` file opens, VSCode activates the extension and starts `gmloop lsp` over stdio.

## Manual Extension Host Launch Configuration

If the repository does not already have a VSCode launch configuration, create one in your local VSCode user/workspace settings or `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run GMLoop VSCode Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/src/vscode"],
      "outFiles": ["${workspaceFolder}/src/vscode/dist/**/*.js"],
      "preLaunchTask": "pnpm: build vscode extension"
    }
  ]
}
```

If you use the `preLaunchTask`, add the matching local task:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "pnpm: build vscode extension",
      "type": "shell",
      "command": "pnpm --filter @gmloop/vscode run build:types",
      "problemMatcher": "$tsc"
    }
  ]
}
```

Do not commit `.vscode` files unless the repository intentionally adopts shared VSCode launch settings.

## Configure The Server Path

The extension contributes this setting:

```json
{
  "gmloop.serverPath": "gmloop"
}
```

Use the default when `gmloop` is available on PATH. Use an absolute path when VSCode cannot find the command:

```json
{
  "gmloop.serverPath": "/Users/henrykirk/GMLoop/src/cli/dist/index.js"
}
```

The extension invokes:

```text
<gmloop.serverPath> lsp
```

## Active LSP Development

For active LSP development, install the VSIX once, keep `gmloop.serverPath` pointed at your local compiled CLI, run `pnpm run build:ts`, then restart the language server in VSCode.

Use this setup when you are changing `@gmloop/lsp`, `@gmloop/semantic`, parser, lint, format, refactor, or other code reached by `gmloop lsp`:

```sh
pnpm run package:vscode
code --install-extension src/vscode/dist/gmloop-0.0.1.vsix
```

In the GameMaker project workspace, set `gmloop.serverPath` to the local compiled CLI if `gmloop` is not already linked on PATH:

```json
{
  "gmloop.serverPath": "/Users/henrykirk/GMLoop/src/cli/dist/index.js"
}
```

After editing GMLoop code:

```sh
pnpm run build:ts
```

Then run this VSCode command from the Command Palette:

```text
GMLoop: Restart Language Server
```

The installed VSCode extension does not contain the language server implementation. It only starts `<gmloop.serverPath> lsp`, so LSP/server changes are picked up by rebuilding the local CLI output and restarting the server. Rebuild and reinstall the VSIX only when `src/vscode` changes or when extension metadata, contributed settings, commands, activation behavior, or extension dependencies change.

There is no automatic server refresh in the extension today. The current reliable loop is:

1. Run `pnpm run build:ts` after code changes.
2. Run `GMLoop: Restart Language Server` in VSCode.

A future development-only watcher could combine those two steps by watching the repo, rebuilding TypeScript, and asking the extension to restart the client, but that behavior is not currently implemented.

For GameMaker projects initialized through GMLoop, this project-local setting can be created automatically with:

```sh
gmloop agent-pack init --path path/to/Game.yyp --vscode
```

That command creates or merges `.vscode/settings.json`, creates or merges `.vscode/extensions.json`, and makes a best-effort attempt to install the GMLoop VSCode extension through the `code` CLI.

Until the extension is published, install the generated `.vsix` directly:

```sh
pnpm run package:vscode
code --install-extension src/vscode/dist/gmloop-0.0.1.vsix
```

## Verify It Is Working

1. Open a `.gml` file in a GameMaker project.
2. Run `GMLoop: Show Language Server Output` from the Command Palette.
3. Confirm the language server starts without errors.
4. Try hover, go-to-definition, references, document symbols, completion, formatting, or rename on GML code.

For semantic navigation features, the opened folder must contain or be nested under a GameMaker `.yyp` project. Parser diagnostics and lint diagnostics can work on individual `.gml` files, but project-aware links and references need project-root discovery.

## Restart The Server

Run this command from the VSCode Command Palette:

```text
GMLoop: Restart Language Server
```

Use this after rebuilding GMLoop or changing `gmloop.serverPath`.

## TODO
- **FEAT**: Add gml syntax highlighting to the extension. Use/reference these as/if applicable: https://github.com/bscotch/stitch/tree/develop/packages/vscode/languages. The GMLoop UI should use the same syntax highlighting as the VSCode extension (the UI already has a syntax highlighter, so that may be able to be used/migrated as a starting point).
