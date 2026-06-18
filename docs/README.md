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
- [`examples/example.eslint.all-rules.config.js`](examples/example.eslint.all-rules.config.js) —
  Flat ESLint config using the preset with all available `@gmloop/lint` rules.
- [`examples/example.mcp.json`](examples/example.mcp.json) — MCP client config
  example that starts the MCP stdio server via the `gmloop mcp` CLI command
  through `pnpm`.
- [`examples/gmloop.json`](examples/gmloop.json) — Baseline project config
  with formatter, lint, refactor, graph, and runtime live-reload settings.

## Usage & rollout

- [Quick start](../README.md#quick-start) — Installation flows for pnpm
  contributors and project maintainers, including local-clone workflows plus
  wrapper scripts you can copy into your GameMaker project.
- [Everyday commands](../README.md#everyday-commands) — Core parser/lint/refactor/
  transpile/watch commands used day-to-day.
- [Configuration reference](../README.md#configuration-reference) — Baseline
  Prettier options for `.gml` files and lint preset wiring examples.
- [CLI wrapper reference](../README.md#cli-wrapper-environment-knobs) — Quick
  lookup for environment variables and wrapper behaviour when scripting formatter
  runs in CI or editor tooling.
- [CLI command guide](../src/cli/README.md) — Full command catalog and
  project-config behavior for parser, lint, refactor, transpile, watch, and
  graph workflows.
- [Formatter workspace reference](../src/format/README.md) — Formatter
  ownership boundaries, deprecated options, and layout conventions for
  `@gmloop/format`.
- [Runtime wrapper reference](../src/runtime-wrapper/README.md) — HTML5
  hot-reload bridge, patch application, and live function swapping.
- [Agent-pack reference](../src/agent-pack/README.md) — Standalone raw Agent
  Skills package and the universal `gmloop agent-pack init` project flow.

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

- [Project target state plan](target-state.md) — Canonical
  ownership contract for formatter vs lint vs refactor responsibilities, including the two-tier malformed GML strategy and the native codemod model.
- [GML graph index plan](gml-graph-index-plan.md) — Architecture and
  ownership contract for the semantic-owned graph index that backs the
  `graph index`, `graph search`, and `graph doctor` CLI commands and the
  MCP and UI graph surfaces.
- [Autonomous GameMaker creator plan](autonomous-game-creator-plan.md) —
  Long-running plan for the higher-level agent-driven game creation system
  that builds on top of the formatter, lint, refactor, semantic, transpiler,
  runtime wrapper, CLI, UI, and MCP workspaces, including the HTML5 runtime
  fork, watcher pipeline, hot-reload integration seams, and independently
  installable `@gmloop/agent-pack` initialization/update flow.
- [Define directive fixing plan](define-directive-fixing.md) — Parser/
  formatter/lint ownership plan for tolerating legacy `#define` spellings and
  related legacy keywords, and producing a normalized macro representation.
- [Stitch parser assessment](stitch-parser-assessment.md) — Comparative
  evaluation of the Stitch (`bscotch/stitch`) Chevrotain-based GML parser and
  project model, plus the decision notes for keeping the ANTLR-based pipeline.
- [Project-index parsing flattening audit (2026-06-04)](architectural-audit-2026-06-04.md) —
  Recent architectural audit of the semantic project-index parser-error
  formatting seam, including the rationale for flattening the helper layout
  under `src/semantic/src/project-index/`.
- [Feather Data Plan](feather-data-plan.md) — Describes the scraping pipeline
  that collects built-in Feather debugger metadata and how the generated files
  are versioned.
- [Architecture overview](../README.md#architecture-overview) — High-level map
  of the workspace packages, where generated assets live, and which scripts
  refresh them.

## Agent and automation surfaces

- [MCP workspace reference](../src/mcp/README.md) — Current
  `@gmloop/mcp` package docs for exposing CLI-adjacent workflows to AI tooling.
- [Agent routing and cadence design](agent-routing-cadence-plan.md) — Design
  for the scheduled agent routing policy in `.github/workflows/weights.json`,
  covering task categories, weighted pair selection, cadence filtering, and
  manual override behaviour.
