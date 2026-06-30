# Daily Architectural Audit: Runtime Wrapper Timing Utilities

Date: 2026-06-30

## Design rationale

The repository already follows the target workspace split in `docs/target-state.md`: runtime hot-reload behavior is owned by `@gmloop/runtime-wrapper`, while CLI, formatter, lint, parser, semantic, refactor, and UI responsibilities remain separate. During a brief top-level survey, the most actionable structural inefficiency was a redundant one-file hierarchy in the runtime wrapper:

- `src/runtime-wrapper/src/browser/timing/index.ts`
- `src/runtime-wrapper/src/browser/timing/timing-utils.ts`

The directory represented a cohesive concept, but the implementation had only one real module plus a pass-through index. That extra layer made local imports deeper without adding ownership clarity. The public workspace API already exposes timing helpers through the stable `RuntimeWrapper.Timing` namespace, so consumers do not need a nested internal directory path to preserve API stability.

## Target architecture

Timing remains a browser-runtime concern inside `@gmloop/runtime-wrapper`, but the implementation now lives at the same depth as other browser-level singleton concerns:

- `src/runtime-wrapper/src/browser/timing.ts`

The workspace-level namespace export remains unchanged, so external consumers continue to use the public `Timing` namespace. Internal runtime and websocket layers import the domain module directly instead of traversing through a pass-through folder index.

## Migration and fallback plan

This refactor intentionally keeps the changed file count small and avoids sweeping file moves:

1. Move the timing implementation from `browser/timing/timing-utils.ts` to `browser/timing.ts`.
2. Delete the now-empty pass-through `browser/timing/index.ts` layer.
3. Update internal imports and runtime-wrapper tests to reference `browser/timing.js`.
4. Keep the public workspace namespace export named `Timing` so external API shape remains stable.

If this move had revealed broader coupling, the fallback plan was to stop after documenting the issue and leave the old files in place. No compatibility shim was added because the only removed path was an internal source layout detail, and callers inside the repository were updated directly.

## Before and after

Before:

```text
src/runtime-wrapper/src/browser/timing/
  index.ts              # pass-through export only
  timing-utils.ts       # actual implementation
```

After:

```text
src/runtime-wrapper/src/browser/
  timing.ts             # actual implementation and direct internal import target
```

## Follow-up candidates deferred

The same survey found other small single-file domains, such as focused codemod folders and fixture-runner discovery/config directories. Those folders often mirror broader workspace conventions or future extension points, so they were deferred rather than flattened in this audit. The runtime-wrapper timing folder was selected because it provided a concrete simplification with no behavior change and no public API churn.
