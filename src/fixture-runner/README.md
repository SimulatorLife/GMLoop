# Fixture Runner

`@gmloop/fixture-runner` is the shared fixture discovery, execution, assertion, and profiling framework used by format, lint, refactor, and integration fixture suites.

Responsibilities:

- load shared `gmloop.json` through `@gmloop/core`
- validate fixture-only `fixture` metadata
- discover directory-per-case fixtures
- reject legacy flat-fixture files such as `options.json`, `fixed.gml`, `*.input.gml`, and `*.output.gml`
- run workspace-owned adapters
- compare outputs through runner-owned comparison modes configured in `fixture.comparison`
- collect time, memory, and CPU metrics
- emit per-fixture memory summaries (`totalHeapUsedDeltaBytes`, `totalMaxRssDeltaBytes`, `peakStageHeapUsedDeltaBytes`)
- enforce canonical fixture stage order: `load -> refactor -> lint -> format -> compare -> total`
- emit human and JSON profile reports, including workspace aggregates, stage aggregates, and budget failures
- support opt-in isolated deep CPU profiles through the root fixture profile runner, which forks a child process per profiled fixture case

Comparison modes:

- `exact`: byte-for-byte expected output, and the default for all fixture kinds
- `ignore-whitespace-and-line-endings`: semantic text comparisons for selected lint fixtures

This workspace depends only on `@gmloop/core`. Product workspaces supply their own adapters and retain ownership of their tool-specific config sections. Repo-level tests import workspace test support through root-only `#fixture-test/*` aliases rather than public package exports. Runner-managed working directories are reserved for true project-tree fixtures; single-file integration fixtures that need a temporary project workspace must manage it in the owning adapter.
