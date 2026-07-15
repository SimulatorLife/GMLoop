# GMLoop VSCode Extension

The extension registers `.gml` files with GMLoop's shared syntax-highlighting inventory and a `source.gml`
TextMate grammar. Its editor configuration for comments, accessors, strings, regions, indentation, and word
boundaries is adapted from [Stitch's GML language support](https://github.com/bscotch/stitch/tree/develop/packages/vscode/languages),
with GMLoop's ANTLR lexer grammar treated as the authoritative syntax contract.

This workspace contains the first-party VSCode client for GMLoop's GameMaker Language server. It registers `.gml` files as the `gml` language and starts the version-matched language server bundled in the VSIX. For development, `gmloop.serverPath` can override the bundle with a CLI launched as:

```sh
gmloop lsp
```

## Syntax And Semantic Highlighting

GMLoop combines a TextMate grammar with semantic tokens from the language server. The grammar colors syntax
immediately, including declarations, constructor types and parameters, enums, macros, member calls, JSDoc, and
Unicode identifiers. Reserved syntax keeps its keyword or operator scope even when followed by parentheses, so
paired control-flow syntax such as `if` and `else` receives consistent theme treatment. Once the server has analyzed
the document, semantic tokens distinguish built-ins, functions, constructors, parameters, local/global/instance
variables, properties, enums, macros, and project resources.

Standalone `.gml` files receive declaration and bundled GameMaker built-in highlighting. Opening a folder containing
a `.yyp` project adds project-aware definition/reference and resource classification. Unsaved document text is used
when semantic tokens are recomputed.

Hover tooltips are available for project symbols and documented GameMaker runtime built-ins such as functions and
instance properties. Language keywords such as `function`, `var`, `constructor`, `if`, `else`, and `repeat` do not
open hover tooltips. GMLoop also suppresses hover results throughout comments and function-documentation blocks,
including tags such as `@desc`, `@param`, and `@returns`.

VSCode combines results from every installed hover provider. The GitHub Pull Requests extension independently treats
raw `@name` text in comments as a GitHub user mention and may therefore show a profile card for a GML documentation
tag even though GMLoop returned no hover. That provider does not expose a language-specific hover exclusion setting;
disable GitHub Pull Requests for the workspace to remove those cards without disabling GMLoop symbol hovers.

To inspect the scope and semantic token applied at the cursor, run VSCode's `Developer: Inspect Editor Tokens and
Scopes` command. Color choices remain controlled by the active VSCode theme; GMLoop contributes standard TextMate
scopes and standard LSP semantic token types rather than installing a custom theme.

## Semantic Analysis Activity

Run `GMLoop: Show Language Server Output` to see each semantic-analysis build as it starts. The output identifies
the tier (`definitions` or `full`), scope (`incremental` or `project`), the affected-file count for incremental
work, and reason. A
`project`-scope `full` build is reserved for a full-capability request such as Find References or Rename when no
current full snapshot is available; ordinary hovers, completions, and document opens use definitions facts and do
not trigger one.

## Prerequisites

- Node.js `>=22.5.0`
- `pnpm`
- VSCode
- GMLoop dependencies installed from the repository root:

```sh
pnpm install
```

No separate CLI installation is required by the packaged extension. During repository development, set `gmloop.serverPath` to the compiled CLI entrypoint when you intentionally want the extension to run current checkout output instead of its bundled server:

```json
{
  "gmloop.serverPath": "/Users/henrykirk/GMLoop/src/cli/dist/index.js"
}
```

The extension appends the fixed `lsp` argument to an override, so do not include `lsp` in `gmloop.serverPath`.

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

After installing, open a GameMaker project folder. The bundled server starts without a global `gmloop` command or additional path configuration.

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
  "gmloop.serverPath": ""
}
```

Keep the default to use the bundled server. Use an absolute path only when developing against a separately built GMLoop checkout:

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

The installed VSCode extension contains the language server version built with that VSIX. When `gmloop.serverPath` points at a local compiled CLI, LSP/server changes are picked up by rebuilding the local CLI output and restarting the server. Rebuild and reinstall the VSIX to update its bundled production server.

There is no automatic server refresh in the extension today. The current reliable loop is:

1. Run `pnpm run build:ts` after code changes.
2. Run `GMLoop: Restart Language Server` in VSCode.

A future development-only watcher could combine those two steps by watching the repo, rebuilding TypeScript, and asking the extension to restart the client, but that behavior is not currently implemented.

## Automatic Local Extension File Syncing

When developing the VSCode extension or modifying its TextMate grammars (`gml.tmLanguage.json`, `markdown-gml.tmLanguage.json`), package manifest (`package.json`), or language configurations (`language-configuration.json`), the extension automatically keeps your installed copy synced:

- **Monorepo Detection**: Upon activation, the extension checks if the GMLoop monorepo workspace is open.
- **Auto-Copy & Reload**: If open, it compares the configuration and grammar files in the monorepo against the installed copy in your global VSCode extensions directory (`~/.vscode/extensions/gmloop.gmloop-0.0.1`). If they differ, it copies the updated files in place and prompts you to reload the VSCode window to apply the changes immediately.


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
- **FEAT**: Have the syntax-highlighting apply to gml code in markdown code fences in `.md` files in VSCode, e.g.
  ```gml
  function foo() {
    return 42;
  }
  ```
