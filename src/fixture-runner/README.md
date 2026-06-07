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
- copy external real-project fixtures into isolated writable temporary directories
- fingerprint whole-project trees and report deterministic changed-file summaries
- parse JSON CLI output for root-owned project workflow assertions without depending on the CLI package

Comparison modes:

- `exact`: byte-for-byte expected output, and the default for all fixture kinds
- `ignore-whitespace-and-line-endings`: semantic text comparisons for selected lint fixtures

Whole-project fixtures:

- use `fixture.kind: "external-project"` with `fixture.externalProject.sourcePath` when a fixture case points at a real project outside the fixture directory
- are copied before execution; tests and adapters must operate only on the copied project path
- exclude transient directories such as `.git`, `.gmcache`, `.gmloop`, `dist`, `reports`, and `tmp` by default
- may add fixture-specific exclusions through `fixture.externalProject.excludes`
- should assert behavior through project fingerprints, changed-file summaries, command payloads, or workspace-owned adapters rather than mutating individual files to seed artificial defects

This workspace depends only on `@gmloop/core`. Product workspaces supply their own adapters and retain ownership of their tool-specific config sections. Repo-level tests import workspace test support through root-only `#fixture-test/*` aliases rather than public package exports. Runner-managed working directories are reserved for true project-tree fixtures; CLI-specific whole-project integration tests should use fixture-runner project helpers while keeping command invocation in the owning root test adapter.
