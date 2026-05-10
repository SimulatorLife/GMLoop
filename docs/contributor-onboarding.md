# Contributor onboarding

Use this checklist the first time you contribute to the repository or when
refreshing a workstation. It complements the Quick start guidance in
[the root README](../README.md#quick-start) with contributor-focused validation
checks.

## 1. Confirm prerequisites

1. Install **Node.js 25.0.0 or newer**. The workspace ships an `.nvmrc`; run
   `nvm install` followed by `nvm use` so local tooling matches CI.
2. Ensure pnpm is available. Confirm versions with `node -v` and `pnpm -v`.
3. Optional but recommended: install [Husky](https://typicode.github.io/husky/)
   Git hooks by keeping `HUSKY` unset. Set `HUSKY=0` to bypass the hooks (for
   example, in ad-hoc CI jobs).

## 2. Install dependencies

```bash
nvm use
pnpm install
```

`pnpm install` installs the exact dependency graph captured in `pnpm-lock.yaml`.
Use `pnpm install` only after verifying the lockfile is current.

## 3. Validate the workspace

Start with the baseline repository checks used in CI-style local validation:

```bash
pnpm run build:ts
pnpm run lint:quiet
```

Then run targeted suites for the workspace(s) you touched:

```bash
pnpm run test:parser
pnpm run test:format
pnpm run test:semantic
pnpm run test:cli
pnpm run test:transpiler
pnpm run test:runtime-wrapper
pnpm run test:refactor
```

Cross-module integration fixtures under `test/fixtures/integration/` are root-level
integration coverage and run only through `pnpm run test`.

Fixtures under `test/fixtures/`, `src/format/test/fixtures/`,
`src/parser/test/**/*.gml`, and `src/lint/test/**/*.gml` are golden—do not edit
them unless you are intentionally changing formatter/parser/lint behavior and
have explicit approval for fixture updates.

Use the fixture profiling commands when performance work touches fixture runners
or adapters:

```bash
pnpm run test:fixtures:profile
pnpm run test:fixtures:profile:deep-cpu
```

Fixture profiling owns memory diagnostics. The generated `reports/fixture-profile.json`
now includes per-fixture memory summaries alongside stage-level metrics, so there is
no separate CLI memory benchmark command.

Both profiling commands use incremental TypeScript builds (`tsc -b`) so repeated
profiling iterations avoid full clean rebuilds.

The deep CPU command now profiles batched fixture cases in a single pass and
writes per-case failures to a JSON report consumed by the profile harness,
avoiding an expensive fallback rerun of every case after the first batch error.

## 4. Sanity-check the formatter

Use these commands to verify the formatter wiring before experimenting on a
GameMaker project:

```bash
pnpm run format:gml -- --help
pnpm run format:gml -- --check
pnpm run cli -- --help
```

The `format:gml` workspace script now pins the `format` subcommand so the help
output spotlights formatter-specific flags. Pair it with the
[CLI wrapper reference](../README.md#cli-wrapper-environment-knobs) when
scripting automation, and fall back to `pnpm run cli -- --help` for the global
command inventory. The global CLI help also notes that passing just a file or
directory path runs the `format` command implicitly, which is useful for quick
one-off formatting checks.

When you're ready to try the wrapper against a project, provide the target
directory explicitly so the command has GameMaker sources to process:

```bash
pnpm run format:gml -- path/to/project
```

## 5. Explore supporting documentation

* Start with the [documentation index](README.md) for deep dives and planning
  notes.
* Read the [project target state](target-state.md) before making architecture or
  ownership-boundary changes.
* Review the [semantic subsystem reference](../src/semantic/README.md) before
  adjusting identifier-case discovery or project-index caching.

Check back with this document when you swap machines or return from a long break
to stay aligned with the latest workflow expectations.
