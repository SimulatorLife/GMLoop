# Documentation index

Use this index to jump to the planning notes and references that shape
GMLoop. The summaries below highlight what each guide covers so you
can pick the right level of detail for your task. Need installation or
onboarding steps? Start with the [repository README](../README.md) for the quick
start workflows, configuration reference, and contributor command reference,
then return here for deeper context.

## Reference guides

- [`examples/example.prettierignore`](examples/example.prettierignore) — Baseline
  ignore file tuned for common GameMaker metadata folders.
- [`examples/example.prettierrc`](examples/example.prettierrc) — Baseline
  Prettier config for formatting `.gml` files in a GameMaker project.
- [`examples/example.eslint.config.js`](examples/example.eslint.config.js) —
  Flat ESLint config that composes the `@gmloop/lint` presets (without TypeScript
  requirement).
- [`examples/example.mcp.json`](examples/example.mcp.json) — MCP client config
  example that starts the MCP stdio server via the `gmloop mcp` CLI command
  through `pnpm`.
- [`examples/gmloop.json`](examples/gmloop.json) — Baseline project config
  with formatter, lint, refactor, graph, and runtime live-reload settings.

## Usage & rollout

- [Quick start](../README.md#quick-start) &mdash; Installation flows for pnpm
  contributors and project maintainers, including local-clone workflows plus
  wrapper scripts you can copy into your GameMaker project.
- [Everyday commands](../README.md#everyday-commands) &mdash; Core parser/lint/refactor/
  transpile/watch commands used day-to-day.
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
- [Architecture target state](target-state.md) — Canonical rules for workspace
  ownership boundaries, dependency direction, and forward-looking design.
- [ANTLR regeneration guide](antlr-regeneration.md) — Canonical steps for
  rebuilding the generated parser artifacts with the vendored toolchain plus
  pointers to the extension hooks that keep custom behaviour outside the
  generated directory.
- [Validation command reference](contributor-onboarding.md#3-validate-the-workspace) — Profiling and validation commands used before opening a pull request.
- [GitHub Releases](https://github.com/SimulatorLife/GMLoop/releases) — Versioned changelog notes for shipped updates.

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
