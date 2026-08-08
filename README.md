# GMLoop

This repository is the source monorepo for various GameMaker Language tools, including:

- a Prettier formatter plugin ([`@gmloop/format`](src/format))
- an ESLint language plugin + rules ([`@gmloop/lint`](src/lint))
- a codemod/refactor engine ([`@gmloop/refactor`](src/refactor))
- a **gml** to **js** transpiler ([`@gmloop/transpiler`](src/transpiler))
- HTML5-runtime live reloading ([`@gmloop/runtime-wrapper`](src/runtime-wrapper))
- a standalone Auto-Game Agent Skills and project-guidance package ([`@gmloop/agent-pack`](src/agent-pack))
- an LSP language server for editors and `lsp-mcp-server` bridges ([`@gmloop/lsp`](src/lsp))
- a first-party VSCode language client ([`@gmloop/vscode`](src/vscode))
- [parser](src/parser), [semantic analysis](src/semantic), [CLI](src/cli), and [MCP](src/mcp) workspaces

## Table of contents

- [Formatter at a glance](#formatter-at-a-glance)
- [Quick start](#quick-start)
- [Architecture overview](#architecture-overview)
- [Agent coordination boundary](#agent-coordination-boundary)
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

- Node.js `25.0.0` for repository development (the version pinned in `.nvmrc`; run `nvm install` and `nvm use`)
- pnpm (`corepack enable pnpm`)

### 2) Clone and install

```bash
git clone https://github.com/SimulatorLife/GMLoop.git
cd GMLoop
git submodule update --init --recursive
nvm install
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

Use the repo CLI wrapper to format any GameMaker project path. The `format`
command (and the related `fix` and `transpile` commands) take their target
exclusively via the `--path` option — passing a positional path no longer
works and produces an actionable usage error that points at `--path`.

```bash
# format writes changes (use --path for the target)
pnpm run cli -- format --path /absolute/path/to/MyGame

# check mode (no writes)
pnpm run cli -- format --path /absolute/path/to/MyGame
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

### Language server from a local clone

`@gmloop/lsp` exposes GML code intelligence through a standard Language
Server Protocol server that speaks JSON-RPC over stdio. Editors and
`lsp-mcp-server` bridges can launch it through the supported CLI command:

```bash
# build the LSP workspace and run its test suite once
pnpm --filter @gmloop/lsp run build:types
pnpm run test:lsp

# run the language server over stdio (launched by an editor or MCP bridge)
pnpm run cli -- lsp
```

The first-party VSCode extension bundles a version-matched server, so its users
do not need a separate global `gmloop` installation. For CLI bridge
configuration and extension development, see [`docs/gml-lsp.md`](docs/gml-lsp.md),
[`src/lsp/README.md`](src/lsp/README.md), and
[`src/vscode/README.md`](src/vscode/README.md).

## Architecture overview

| Workspace | Path | Responsibility |
| --- | --- | --- |
| `@gmloop/format` | `src/format/` | Formatter-only Prettier plugin surface |
| `@gmloop/lint` | `src/lint/` | ESLint v9 language plugin + lint rules |
| `@gmloop/refactor` | `src/refactor/` | Cross-file refactor planning/application |
| `@gmloop/lsp` | `src/lsp/` | Editor-agnostic LSP server for editors and `lsp-mcp-server` |
| `@gmloop/vscode` | `src/vscode/` | First-party VSCode language client and syntax integration |
| `@gmloop/parser` | `src/parser/` | GML parsing (ANTLR + AST construction) |
| `@gmloop/semantic` | `src/semantic/` | Project indexing, symbol resolution, and semantic analysis |
| `@gmloop/transpiler` | `src/transpiler/` | GML -> JavaScript emission |
| `@gmloop/runtime-wrapper` | `src/runtime-wrapper/` | HTML5 runtime hot-reload bridge |
| `@gmloop/core` | `src/core/` | Shared AST/types/helpers and static GameMaker language metadata |
| `@gmloop/syntax-highlight` | `src/syntax-highlight/` | Shared GML syntax-highlighting definitions used by editor and UI surfaces |
| `@gmloop/fixture-runner` | `src/fixture-runner/` | Shared fixture discovery, execution, assertion, and profiling framework used by format/lint/refactor/integration suites |
| `@gmloop/cli` | `src/cli/` | Unified command-line entrypoints |
| `@gmloop/mcp` | `src/mcp/` | MCP server surface for AI tooling integrations |
| `@gmloop/ui` | `src/ui/` | Cross-project UI surfaces (graph, docs, fix, live-reload, playground) |
| `@gmloop/agent-pack` | `src/agent-pack/` | Independently installable, vendor-neutral Auto-Game Agent Skills and project guidance |

The Auto-Game agent pack is designed for standalone use in a game repository:

```bash
npm install -D @gmloop/agent-pack
```

Its published payload is ordinary Agent Skills directories plus portable project
guidance, so consumers can inspect, copy, or point compatible tooling at the raw
resources without installing the rest of GMLoop. When using the GMLoop UI, the
Auto-Game page offers an initialize or update button whenever the opened project
has no recorded pack installation or an older version.

The agent pack has no separate executable or postinstall mutation. The one
universal command surface remains GMLoop's CLI:

```bash
gmloop agent-pack init --path path/to/Game.yyp
```

## Agent Coordination Boundary

GMLoop is a first-class GameMaker companion surface for AI agents, not a
general multi-agent coordinator. It owns GameMaker-specific project
understanding, semantic graph context, parser/lint/refactor/format/fix
workflows, live-reload status, MCP tool exposure, agent-pack installation,
skill discovery, and project guidance.

GMLoop should complement, not replace, the official GameMaker CLI. In
auto-game workflows, agents may use both GMLoop's MCP server and
[YoYoGames/gm-cli](https://github.com/YoYoGames/gm-cli)'s ResourceTool MCP
server directly. GMLoop owns GameMaker-specific semantic context, validation,
lint/format/refactor workflows, hot reload, graph-backed inspection, task
evidence, and missing high-level automation. It should avoid recreating
official `gm-cli` project/resource/build/manual/publish capabilities unless
GMLoop-specific context or behavior is required.

External agent coordinators such as Codex, Claude Code, Qwen, OpenHands,
AutoGen, CrewAI, and LangGraph own model selection, agent scheduling,
permissions, approvals, retries, memory, budgets, queues, task routing, and
long-running workflow state.

```text
External agent coordinator
        |
        | MCP + project files + skills + guidance
        v
GMLoop
  parser / semantic graph / lint / refactor / format / fix / live reload / UI / MCP
        |
        v
GameMaker project
```

The Auto-Game or Agents UI may present skills, packaged guidance, tool
readiness, graph/search context, validation evidence, fix/refactor actions, and
live-reload status. It may offer lightweight handoffs such as copying a prompt,
opening an external agent, or launching a configured companion command. It must
not become a multi-agent DAG editor, model router, arbitrary-framework prompt
debugger, workflow engine, approval or permission system, memory store, or
background task queue.

Agent-framework integrations are optional adapters over stable local contracts.
The core product remains vendor-neutral and coordinator-neutral.

## Everyday commands

```bash
# full validation (format check + lint + tests)
pnpm run format:check && pnpm run lint:quiet && pnpm test

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
| `WATCH_STATUS_HOST` / `WATCH_STATUS_PORT` | Defaults for `live-reload status --status-host` / `live-reload status --status-port` (mirrors `watch --status-host` / `watch --status-port`). |

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

export default [...Lint.configs.all];
```

`Lint.configs.all` enables every `gml/*` and `feather/*` rule at its recommended
`"warn"` or `"error"` level. The narrower `recommended`, `feather`, and
`performance` presets remain available for custom composition.

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

Supported `lintRuleset` values are `"all"`, `"recommended"`, `"feather"`, and
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
# iterative local development
pnpm run build:ts
pnpm run lint:quiet
pnpm test

# pre-PR / CI-style validation
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

- [`docs/README.md`](docs/README.md) (documentation index — also lists historical
  [architectural audits](docs/architectural-audits/) and Codex subagent
  contracts)
- [`docs/target-state.md`](docs/target-state.md) (project architecture target state)
- [`docs/contributor-onboarding.md`](docs/contributor-onboarding.md) (first-time contributor checklist)
- [`src/cli/README.md`](src/cli/README.md) (full command catalog)
- [`src/format/README.md`](src/format/README.md) (formatter ownership and conventions)
- [`src/semantic/README.md`](src/semantic/README.md) (scope/symbol analysis)
- [`src/refactor/README.md`](src/refactor/README.md) (codemod/refactor transactions)
- [`src/lint/README.md`](src/lint/README.md) (ESLint language plugin + rules)
- [`src/transpiler/README.md`](src/transpiler/README.md) (GML → JavaScript emission)
- [`src/runtime-wrapper/README.md`](src/runtime-wrapper/README.md) (HTML5 hot-reload bridge)
- [`src/agent-pack/README.md`](src/agent-pack/README.md) (Auto-Game Agent Skills and portable project guidance)
- [`src/ui/README.md`](src/ui/README.md) (graph, docs, fix, live-reload, and playground UI surfaces)
- [`src/mcp/README.md`](src/mcp/README.md) (MCP server surface for AI tooling)
- [`src/lsp/README.md`](src/lsp/README.md) (editor-agnostic LSP server), [`src/vscode/README.md`](src/vscode/README.md) (first-party VSCode client), and [`docs/gml-lsp.md`](docs/gml-lsp.md) (LSP setup notes)
- [`src/fixture-runner/README.md`](src/fixture-runner/README.md) (shared fixture discovery, execution, and profiling framework)
- [GitHub Releases](https://github.com/SimulatorLife/GMLoop/releases) (project changelog and release notes)

## References / Tools / Docs

- [ANTLR4 Grammar Syntax Support (VS Code)](https://marketplace.visualstudio.com/items?itemName=mike-lischke.vscode-antlr4)
- [GML Support (VS Code)](https://marketplace.visualstudio.com/items?itemName=electrobrains.gml-support)
- [Prettier (VS Code)](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
- [jscpd CLI](https://github.com/kucherenko/jscpd/tree/master/apps/jscpd)
- [GameMaker Igor CI Building](https://manual.gamemaker.io/lts/en/Settings/Building_via_Command_Line.htm)
- [GameMaker CLI](https://github.com/YoYoGames/gm-cli)
