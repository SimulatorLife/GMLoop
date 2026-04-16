# Daily Architecture Audit — 2026-04-16

## Design rationale

### Current pain points

- The CLI `commands/` directory mixed a top-level watch command (`watch.ts`) with three watch-only support modules (`watch-constants.ts`, `watch-source-analysis.ts`, `watch-status.ts`).
- This spread one cohesive concept across sibling files and made discovery/navigation harder for contributors who expect command subdomains to be grouped.
- The split also increased import churn because unrelated command modules and tests referenced watch-specific helpers from the `commands/` root.

### Target architecture

- Keep `watch.ts` as the primary watch command entry point.
- Group watch-only support modules under `src/cli/src/commands/watch/` so all secondary watch concerns (constants, source analysis, watch-status command) live under one domain directory.
- Preserve existing public command exports through `src/cli/src/commands/index.ts` while reducing top-level command-surface fragmentation.

## Migration and fallback plan

1. Move the three watch support files into `commands/watch/` with stable filenames (`constants.ts`, `source-analysis.ts`, `status.ts`).
2. Add `commands/watch/index.ts` as the directory export surface.
3. Update imports in runtime code and tests to the new paths.
4. Keep `commands/index.ts` exporting watch APIs so consumers relying on the command barrel remain stable.
5. Validate with TypeScript build + lint.

Fallback: if any downstream consumer unexpectedly depends on removed file paths, the change can be reverted by moving files back and restoring import paths without API behavior changes.

## Refactor executed

### Before

```text
src/cli/src/commands/
  watch.ts
  watch-constants.ts
  watch-source-analysis.ts
  watch-status.ts
```

### After

```text
src/cli/src/commands/
  watch.ts
  watch/
    constants.ts
    source-analysis.ts
    status.ts
    index.ts
```

## Why this is high-impact

- Improves conceptual cohesion for one of the CLI's largest command domains.
- Reduces root-level command directory noise without changing command behavior.
- Establishes a clearer pattern for future command subdomain organization.
