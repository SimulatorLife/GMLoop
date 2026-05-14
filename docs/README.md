# Documentation index

Use this index to jump to the planning notes and references that shape
GMLoop. The summaries below highlight what each guide covers so you
can pick the right level of detail for your task. Need installation or
onboarding steps? Start with the [repository README](../README.md) for the quick
start workflows, configuration reference, and contributor command reference,
then return here for deeper context.

## Reference guides

> **Note:** The following sample config files are documented but not yet
> committed. Each link describes the target; create the file when adding that
> surface.

- [`examples/example.prettierignore`](examples/example.prettierignore) *(planned)* — Baseline
  ignore file tuned for common GameMaker metadata folders.
- [`examples/example.prettierrc`](examples/example.prettierrc) *(planned)* — Baseline
  Prettier config for formatting `.gml` files in a GameMaker project.
- [`examples/example.eslint.config.js`](examples/example.eslint.config.js) *(planned)* —
  Flat ESLint config that composes the `@gmloop/lint` presets (without TypeScript
  requirement).
- [`examples/example.mcp.json`](examples/example.mcp.json) — MCP client config
  example that starts the local `@gmloop/mcp` stdio server through `pnpm`.
- [`examples/gmloop.json`](examples/gmloop.json) *(planned)* — Baseline project config
  with formatter, lint, and refactor settings.

## Usage & rollout

- [Quick start](../README.md#quick-start) &mdash; Installation flows for pnpm
  contributors and project maintainers, including local-clone workflows plus
  wrapper scripts you can copy into your GameMaker project.
- [Configuration reference](../README.md#configuration-reference) &mdash; Baseline
  Prettier options for `.gml` files and lint preset wiring examples.
- [CLI wrapper reference](../README.md#cli-wrapper-environment-knobs) &mdash; Quick
  lookup for environment variables and wrapper behaviour when scripting formatter
  runs in CI or editor tooling.
- [CLI command guide](../src/cli/README.md) &mdash; Full command catalog and
  project-config behavior for parser, lint, refactor, transpile, watch, and
  graph workflows.

## Contributor workflow

- [Contributor onboarding checklist](contributor-onboarding.md) — Environment
  setup, baseline validation (`build:ts`, `lint:quiet`), and supporting
  documentation for new contributors.
- [ANTLR regeneration guide](antlr-regeneration.md) — Canonical steps for
  rebuilding the generated parser artifacts with the vendored toolchain plus
  pointers to the extension hooks that keep custom behaviour outside the
  generated directory.
- [Validation command reference](contributor-onboarding.md#3-validate-the-workspace) — Profiling and validation commands used before opening a pull request.

## Extension hooks & overrides

The format workspace exposes several extension hooks that let integrators run controlled
experiments without permanently widening the public option surface. Comprehensive
documentation for these hooks is pending; consult the source files for
implementation details:

- **Line-comment options resolver** (`@gmloop/core`)
  — Adjust commented-code detection heuristics without forking the formatter.
  Normalization guards keep overrides safe even when hosts
  provide partial data.
- **Statement newline padding extension** — Register additional AST node
  types that should inherit blank-line padding around statements while keeping
  the opinionated defaults intact for other consumers.
- **Core option overrides** (`src/format/src/options/core-option-overrides.ts`)
  — Swap or remove the hard-coded Prettier clamps (such as
  `trailingComma: "none"`) when a host needs different defaults, all while
  keeping the formatter opinionated by default.

## Architecture, planning

- [Project target state plan](target-state.md) &mdash; Canonical
  ownership contract for formatter vs lint vs refactor responsibilities, including the two-tier malformed GML strategy and the native codemod model. Concepts, architecture, and integration HTML5 runtime fork, watcher pipeline, and runtime integration seams required for hot-reload tooling.
- [Feather Data Plan](feather-data-plan.md) — Describes the scraping pipeline
  that collects built-in Feather debugger metadata and how the generated files
  are versioned.
- [Architecture overview](../README.md#architecture-overview) — High-level map
  of the workspace packages, where generated assets live, and which scripts
  refresh them.

## Agent and automation surfaces

- [MCP workspace reference](../src/mcp/README.md) &mdash; Current
  `@gmloop/mcp` package docs for exposing CLI-adjacent workflows to AI tooling.
