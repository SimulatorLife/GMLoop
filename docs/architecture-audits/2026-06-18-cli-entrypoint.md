# Architectural Audit: CLI Entrypoint Guard Consolidation (2026-06-18)

## Design rationale

The daily survey focused on top-level workspace shape, public API barrels, and shallow single-purpose modules. The clearest structural inefficiency was in `@gmloop/cli`: the main `cli.ts` module owned both full command orchestration and low-level process-entrypoint detection. That mixed two concepts in one large entrypoint file:

- command registration, catalog creation, MCP catalog exposure, and test capture helpers; and
- reusable main-module guard behavior for package binaries, direct command modules, skip flags, and Node test-runner detection.

The target architecture keeps CLI command orchestration in the CLI workspace while concentrating process-launch mechanics in the existing `cli-core/main-module-runner.ts` module. This preserves the public `@gmloop/cli` API and keeps imports side-effect safe for MCP and tests.

## Migration and fallback plan

This refactor deliberately avoids sweeping file moves. The public `CLI.__test__` hooks remain available from the same package entrypoint, so existing tests and downstream consumers do not need migration. If a follow-up issue finds more direct-execution command modules, they can adopt the same `cli-core/main-module-runner.ts` helpers without adding new compatibility shims or alternate entrypoints.

## Before

`src/cli/src/cli.ts` contained package-level command orchestration plus private helpers for:

- resolving real paths;
- detecting Node test-runner execution;
- comparing package entrypoints against `src/cli.ts`; and
- combining entrypoint, test-runner, and skip-flag checks.

That made the package entrypoint responsible for reusable process-runner policy even though `src/cli/src/cli-core/main-module-runner.ts` already owned direct module execution helpers.

## After

`src/cli/src/cli-core/main-module-runner.ts` now owns the reusable process-entrypoint guard helpers, including skip-flag integration and test-runner detection. `src/cli/src/cli.ts` imports those helpers and remains focused on the command surface, catalog exports, test capture, and final command dispatch.

## Deferred follow-ups

- Review whether command modules that still contain one-off direct-execution boilerplate can be migrated to the same core runner helper.
- Review very small `index.ts` export surfaces only when a domain directory itself is unclear; do not remove required workspace barrels merely because they are short.
