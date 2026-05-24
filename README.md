# GMLoop

This repository is the source monorepo for various GameMaker Language tools, including:

- a Prettier formatter plugin ([`@gmloop/format`](src/format))
- an ESLint language plugin + rules ([`@gmloop/lint`](src/lint))
- a codemod/refactor engine ([`@gmloop/refactor`](src/refactor))
- a **gml** to **js** transpiler ([`@gmloop/transpiler`](src/transpiler))
- HTML5-runtime live reloading ([`@gmloop/runtime-wrapper`](src/runtime-wrapper))
- [parser](src/parser), [semantic analysis](src/semantic), and [CLI](src/cli) workspaces

## Table of contents

- [Formatter at a glance](#formatter-at-a-glance)
- [Quick start](#quick-start)
- [Architecture overview](#architecture-overview)
- [Everyday commands](#everyday-commands)
- [CLI wrapper environment knobs](#cli-wrapper-environment-knobs)
- [Configuration reference](#configuration-reference)
- [Development](#development)
- [Documentation map](#documentation-map)

## Formatter at a glance

Formatter ([`@gmloop/format`](src/format)) does layout/canonical rendering only (whitespace, semicolons, etc). It does not rewrite code or change semantics.

```gml
// input
function demo(){var stats={}
stats.hp=100; stats.mp=50; return stats;}

// output
function demo() {
    var stats = {};
    stats.hp = 100;
    stats.mp = 50;
    return stats;
}
```

Lint (`lint --write`) does single-file-scoped semantic/content rewrites (rule-owned).

## Quick start

### 1) Prerequisites

- Node.js `>=25.0.0` (matches the pinned workspace default in `.nvmrc`)
- pnpm (`corepack enable pnpm`)

### 2) Clone and install

```bash
git clone https://github.com/SimulatorLife/GMLoop.git
cd GMLoop
git submodule update --init --recursive
nvm use
pnpm install
pnpm run cli -- --help
```

### 3) Run baseline validation

```bash
pnpm run build:ts
pnpm run lint:quiet
```

Need contributor-focused setup and validation expectations? Continue with [`docs/contributor-onboarding.md`](docs/contributor-onboarding.md).
For a guided docs tour, start with the [documentation index](docs/README.md).

If you're planning architecture or boundary changes, read [`docs/target-state.md`](docs/target-state.md) before implementing so parser/core/format ownership remains aligned.

### Format from a local clone

Use the repo CLI wrapper to format any GameMaker project path:

```bash
# format writes changes
pnpm run format:gml -- /absolute/path/to/MyGame

# check mode (no writes)
pnpm run format:gml -- /absolute/path/to/MyGame --check
```

`format:gml` now targets `.gml` files only. The old `--extensions` option and
`PRETTIER_PLUGIN_GML_DEFAULT_EXTENSIONS` override were removed because GameMaker
Language source is canonical `.gml`, and extension configurability created
unnecessary ambiguity.

### Lint from a local clone

```bash
# diagnostics only
pnpm run cli -- lint /absolute/path/to/MyGame

# diagnostics + autofix
pnpm run cli -- lint /absolute/path/to/MyGame --write
```

### Parse from a local clone

```bash
# write AST JSON to stdout
pnpm run cli -- parse --path /absolute/path/to/MyGame/scripts/demo.gml

# write sibling *.ast.json files
pnpm run cli -- parse --write --path /absolute/path/to/MyGame
```

### Refactor from a local clone

The refactor workspace implements a GML-native Collection API (similar to `jscodeshift`) for atomic cross-file transactions and metadata edits.

```bash
# preview rename (dry-run is the default; no files are written without --write)
pnpm run cli -- refactor --old-name player_hp --new-name playerHealth

# apply rename
pnpm run cli -- refactor --old-name player_hp --new-name playerHealth --write
```

### Transpile from a local clone

```bash
# dry-run transpile (prints JavaScript to stdout)
pnpm run cli -- transpile --path /absolute/path/to/MyGame/scripts/scr_demo/scr_demo.gml

# write .js outputs for all discovered .gml files under the target path
pnpm run cli -- transpile --write --path /absolute/path/to/MyGame
```

## Architecture overview

| Workspace | Path | Responsibility |
| --- | --- | --- |
| `@gmloop/format` | `src/format/` | Formatter-only Prettier plugin surface |
| `@gmloop/lint` | `src/lint/` | ESLint v9 language plugin + lint rules |
| `@gmloop/refactor` | `src/refactor/` | Cross-file refactor planning/application |
| `@gmloop/parser` | `src/parser/` | GML parsing (ANTLR + AST construction) |
| `@gmloop/semantic` | `src/semantic/` | Project indexing and semantic analysis |
| `@gmloop/transpiler` | `src/transpiler/` | GML -> JavaScript emission |
| `@gmloop/runtime-wrapper` | `src/runtime-wrapper/` | HTML5 runtime hot-reload bridge |
| `@gmloop/core` | `src/core/` | Shared AST/types/helpers |
| `@gmloop/cli` | `src/cli/` | Unified command-line entrypoints |
| `@gmloop/mcp` | `src/mcp/` | MCP server surface for AI tooling integrations |

## Everyday commands

```bash
# full validation (format check + lint + tests)
pnpm run check

# full test suite
pnpm test

# targeted suites
pnpm run test:format
pnpm run test:lint
pnpm run test:cli

# formatter
pnpm run format:gml -- /path/to/project

# parser AST inspection
pnpm run cli -- parse --path /path/to/project/scripts/demo.gml
pnpm run cli -- parse --write --path /path/to/project

# lint
pnpm run cli -- lint /path/to/project --write

# refactor
pnpm run cli -- refactor --old-name old_name --new-name newName

# refactor codemod (list configured codemods)
pnpm run cli -- refactor codemod --list

# fix (project-wide: refactor codemods + lint autofixes + format)
pnpm run cli -- fix --path /path/to/project
pnpm run cli -- fix --path /path/to/project --write

# graph index (build dual-root semantic graph index)
pnpm run cli -- graph index
pnpm run cli -- graph index --path /path/to/project --force

# graph search (query the graph index)
pnpm run cli -- graph search "player"
pnpm run cli -- graph search "player" --path /path/to/project

# graph doctor (validate graph index health)
pnpm run cli -- graph doctor --path /path/to/project

# transpile
pnpm run cli -- transpile --write --path /path/to/project

# hot-reload watch pipeline
pnpm run cli -- watch /path/to/project --verbose

# query the watch status server (--status-port and --status-host mirror watch's flags)
pnpm run cli -- live-reload status
pnpm run cli -- live-reload status --status-port 18000 --endpoint health
```

## CLI wrapper environment knobs

These are the most commonly used CLI environment overrides.

| Variable | Purpose |
| --- | --- |
| `PRETTIER_PLUGIN_GML_DEFAULT_ACTION` | Set default CLI action when no command is provided (`help` or `format`). |
| `PRETTIER_PLUGIN_GML_ON_PARSE_ERROR` | Default parse error strategy for `format` (`abort`, `skip`, `revert`). |
| `PRETTIER_PLUGIN_GML_LOG_LEVEL` | Default log level for formatter wrapper output. |
| `PRETTIER_PLUGIN_GML_FORMAT_PATH` / `PRETTIER_PLUGIN_GML_FORMAT_PATHS` | Override format entry-point resolution paths. |
| `PRETTIER_PLUGIN_GML_IGNORED_FILE_SAMPLE_LIMIT` | Cap ignored-file samples in formatter summary output. |
| `PRETTIER_PLUGIN_GML_SKIPPED_DIRECTORY_SAMPLE_LIMIT` | Cap skipped-directory samples in formatter summary output. |
| `PRETTIER_PLUGIN_GML_UNSUPPORTED_EXTENSION_SAMPLE_LIMIT` | Cap unsupported-extension samples in formatter summary output. |
| `WATCH_STATUS_HOST` / `WATCH_STATUS_PORT` | Defaults for `watch-status --status-host` / `watch-status --status-port` (mirrors `watch --status-host` / `watch --status-port`). |

Use `pnpm run cli -- <command> --help` for full option details.

## Configuration reference

### Formatter configuration

The formatter is Prettier-based. Scope formatter config to `.gml` files.

```json
{
  "overrides": [
    {
      "files": "*.gml",
      "options": {
        "parser": "gml-parse",
        "printWidth": 120,
        "tabWidth": 4,
        "semi": true,
        "allowInlineControlFlowBlocks": false,
        "logicalOperatorsStyle": "keywords"
      }
    }
  ]
}
```

Current formatter-specific options exposed by `@gmloop/format`:
- `allowInlineControlFlowBlocks` — allow short, comment-free braced control-flow blocks (`if`, `while`, `repeat`, `with`) to stay on one line when the complete statement fits within `printWidth`; defaults to `false`
- `logicalOperatorsStyle` (`"keywords"` or `"symbols"`)

### Lint configuration

Use the lint workspace presets in flat ESLint config:

```ts
import { Lint } from "@gmloop/lint";

export default [...Lint.configs.recommended];
```

Common composition:

```ts
import { Lint } from "@gmloop/lint";

export default [
    ...Lint.configs.recommended,
    ...Lint.configs.feather,
    ...Lint.configs.performance
];
```

`gmloop.json` also supports lint preset selection for fixture/integration and
project-config-driven lint flows via `lintRuleset`:

```json
{
  "lintRuleset": "recommended",
  "lintRules": {
    "gml/no-globalvar": "error"
  }
}
```

Supported `lintRuleset` values are `"recommended"`, `"feather"`, and
`"performance"`. `lintRules` remains optional and overrides rules from the
selected ruleset when both are present.

See [Workspace ownership boundaries](docs/target-state.md#22-workspace-ownership-boundaries) for the current formatter/lint/refactor ownership contract.

## Development

### Setup

```bash
git submodule update --init --recursive
nvm use
pnpm install
```

### Common scripts

```bash
pnpm run build:ts
pnpm run lint:ci
pnpm run format:check
pnpm run report
pnpm run cli -- --help
```

### Workspace shape

Each workspace follows:
- `package.json`
- `index.ts`
- `tsconfig.json`
- `src/`
- `test/`

Generated artifacts live in `dist/` and are disposable.

## Documentation map

Start here for deeper context and plans:

- [`docs/README.md`](docs/README.md) (documentation index)
- [`docs/target-state.md`](docs/target-state.md) (project architecture target state)
- [`docs/contributor-onboarding.md`](docs/contributor-onboarding.md) (first-time contributor checklist)
- [`src/cli/README.md`](src/cli/README.md)
- [`src/semantic/README.md`](src/semantic/README.md)
- [`src/refactor/README.md`](src/refactor/README.md)
- [`src/lint/README.md`](src/lint/README.md)
- [`src/mcp/README.md`](src/mcp/README.md)
- [GitHub Releases](https://github.com/SimulatorLife/GMLoop/releases) (project changelog and release notes)

## References / Tools / Docs

- [ANTLR4 Grammar Syntax Support (VS Code)](https://marketplace.visualstudio.com/items?itemName=mike-lischke.vscode-antlr4)
- [GML Support (VS Code)](https://marketplace.visualstudio.com/items?itemName=electrobrains.gml-support)
- [Prettier (VS Code)](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [jscpd CLI](https://github.com/kucherenko/jscpd/tree/master/apps/jscpd)
- [GameMaker Igor CI Building](https://manual.gamemaker.io/lts/en/Settings/Building_via_Command_Line.htm)
- [GameMaker CLI](https://github.com/YoYoGames/gm-cli)
