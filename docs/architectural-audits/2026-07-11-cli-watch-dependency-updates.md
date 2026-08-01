# Architectural Audit: CLI Watch Dependency Updates

## Design Rationale

The daily architectural survey started at the repository boundaries and then narrowed to the CLI because it has a concentrated orchestration role: it coordinates parser, transpiler, live-reload, runtime server, and WebSocket workflows without owning their domain internals. The most visible structural pressure was `src/cli/src/commands/watch.ts`, a multi-thousand-line command module that mixed command registration, file watching, runtime lifecycle, source scanning, dependency invalidation, dependent retranspilation, and deleted-file cache cleanup.

The target architecture in `docs/target-state.md` calls for clear workspace responsibility, bounded watch-mode behavior, and discoverable command orchestration. The watch command should remain the user-facing coordinator, while cohesive subdomains under `src/cli/src/commands/watch/` should own focused watch-mode operations.

## Survey Findings

- `src/cli/src/commands/watch.ts` was the largest CLI command module and exceeded the repository's preferred source-file size target.
- The `src/cli/src/commands/watch/` directory already existed for focused watch-mode concepts such as source analysis, extension normalization, constants, and status helpers.
- Dependency invalidation and deleted-file cleanup were cohesive watch-mode concerns, but they were embedded in the main command file beside command registration and watcher lifecycle code.
- Moving this logic into the existing watch subdirectory improves structure without changing public package exports, command names, CLI flags, or runtime behavior.

## Migration and Fallback Plan

This audit intentionally avoided sweeping moves. The migration moved one cohesive internal concern into one new internal module and updated only the main watch command import path. If a regression appeared, the fallback would be to revert the single new module and restore the extracted functions to `watch.ts`; no public API migration or compatibility shim would be required because the extracted module is internal to the CLI command implementation.

Follow-up audits can separately evaluate additional watch-command slices, such as runtime server startup, watcher registration, or initial scan orchestration. Those moves should be performed one concern at a time to keep diffs reviewable.

## Before and After

### Before

`src/cli/src/commands/watch.ts` contained both the high-level watch command orchestration and the lower-level dependency-update mechanics:

- dependent retranspilation fan-out;
- symbol definition delta calculation;
- dependency tracker updates;
- removed-file dependency cleanup;
- cached patch cleanup for deleted sources.

### After

`src/cli/src/commands/watch.ts` imports dependency-update operations from `src/cli/src/commands/watch/dependency-updates.ts`, leaving the main command file focused on command lifecycle, watcher setup, file-event routing, and scan orchestration. The new module groups dependency graph updates, dependent retranspilation, and cleanup of dependency-related state under a single watch-mode concept.

## Behavior and API Stability

- Public CLI commands and options are unchanged.
- Workspace package exports are unchanged.
- No generated files, `dist` files, submodules, or golden `.gml` fixtures were modified.
- The refactor preserves the existing watch-mode dependency invalidation algorithm and cleanup behavior while making the ownership boundary more explicit.
