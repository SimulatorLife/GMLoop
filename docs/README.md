# Documentation index

Use this index to jump to the planning notes and references that shape
GMLoop. The summaries below highlight what each guide covers so you
can pick the right level of detail for your task. Need installation or
onboarding steps? Start with the [repository README](../README.md) for the quick
start workflows, configuration reference, and contributor command reference,
then return here for deeper context.

## Reference guides

- [Sample `.prettierignore`](examples/example.prettierignore) — Baseline ignore
  file tuned for common GameMaker metadata folders.
- [Sample `.prettierrc`](examples/example.prettierrc) — Baseline Prettier
  config for formatting `.gml` files in a GameMaker project.
- [Sample `eslint.config.js`](examples/example.eslint.config.js) — Flat ESLint
  config that composes the `@gmloop/lint` presets (without TypeScript requirement)

## Usage & rollout

- [Quick start](../README.md#quick-start) &mdash; Installation flows for pnpm
  consumers and nightly testers, including side-by-side snippets for the
  published package versus the Git workspace install, plus wrapper scripts you
  can copy into your GameMaker project.
- [Configuration reference](../README.md#configuration-reference) &mdash; Baseline
  Prettier options for `.gml` files, plus the identifier-case defaults surfaced
  by the formatter workspace.
- [CLI wrapper reference](../README.md#cli-wrapper-environment-knobs) &mdash; Quick
  lookup for environment variables and wrapper behaviour when scripting formatter
  runs in CI or editor tooling.

## Contributor workflow

- [Contributor onboarding checklist](contributor-onboarding.md) — Environment
  setup, validation commands, and supporting documentation for new
  contributors.
- [ANTLR regeneration guide](antlr-regeneration.md) — Canonical steps for
  rebuilding the generated parser artifacts with the vendored toolchain plus
  pointers to the extension hooks that keep custom behaviour outside the
  generated directory.
- [Lint performance notes](lint-performance.md) — Profiling workflow and
  regression coverage for expensive lint auto-fix rules.

## Extension hooks & overrides

The format workspace exposes several extension hooks that let integrators run controlled
experiments without permanently widening the public option surface. Comprehensive
documentation for these hooks is pending; consult the source files for
implementation details:

- **Line-comment options resolver** (`@gmloop/core`)
  — Adjust commented-code detection heuristics without forking the formatter.
  Normalization guards keep overrides safe even when hosts
  provide partial data.
- **Doc comment type normalization** (`src/format/src/comments/`)
  — Extend the doc-comment type synonym tables or resource prefixes without
  patching the formatter's defaults. Resolver helpers expose guardrails and a
  restore helper when experiments end.
- **Statement newline padding extension** — Register additional AST node
  types that should inherit blank-line padding around statements while keeping
  the opinionated defaults intact for other consumers.
- **Core option overrides** (`src/format/src/options/core-option-overrides.js`)
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

## TODO / Ideas

- Create a new workspace for a GML-tooling MCP server that wraps/exposes the CLI's commands (`@gmloop/mcp`) so an AI agent can interact/invoke the tools.
