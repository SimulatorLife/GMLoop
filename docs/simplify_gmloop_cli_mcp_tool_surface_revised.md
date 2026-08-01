# Simplify GMLoop CLI/MCP Tool Surface

## Summary

Collapse duplicate read, validation, inspection, and lifecycle tools into a smaller set of owner-oriented commands. The CLI should expose the workflows a human or normal terminal session should run directly, while MCP should expose only agent-useful workflows and synchronization helpers.

Because most MCP tools are derived from CLI leaf commands, simplify the CLI command tree first and let MCP follow where the same workflow is appropriate. The exception is live-reload patch synchronization: `gmloop_live_reload_wait_for_patch` remains an MCP automation-only synchronization tool, not a normal CLI workflow. It does not apply patches. It only waits until an already-running live-reload session reports a new patch after the caller has changed files.

Do not add compatibility aliases. Remove obsolete tool names and update docs/tests to the new surface.

## Live-Reload Lifecycle Surface

### Human/CLI Surface

Keep only the normal human-facing live-reload lifecycle workflows:

- `live-reload dev`
- `live-reload status`
- `live-reload discover`

These are the commands a developer should use directly from a terminal:

- `live-reload dev` owns starting and running the live-reload development session.
- `live-reload status` reports the current session state, including patch/session metadata such as the latest patch id.
- `live-reload discover` locates a running live-reload session that other tools can attach to or inspect through supported status APIs.

Do not expose `live-reload wait-for-patch` as a normal CLI workflow. Humans can use `live-reload status` directly when they need to inspect patch state.

### MCP/Automation Surface

Expose the same lifecycle workflows to MCP, plus one automation-only synchronization helper:

- `gmloop_live_reload_dev`
- `gmloop_live_reload_status`
- `gmloop_live_reload_discover`
- `gmloop_live_reload_wait_for_patch`

`gmloop_live_reload_wait_for_patch` is intentionally retained because agents frequently need a reliable post-edit synchronization point. After an agent changes files, it can call this tool to wait until the running live-reload session observes and reports a new patch.

This tool must remain narrow:

- It does not start live-reload.
- It does not build live-reload output directly.
- It does not prepare a session.
- It does not attach to a session as a separate lifecycle step.
- It does not apply patches.
- It does not mutate source files.
- It only waits for the running live-reload session to report a patch newer than the caller's baseline patch id.

Removing this helper entirely would force every MCP caller or agent to reinvent polling against `status.lastPatchId`. That duplication is more error-prone, likely to create flaky automation, and likely to produce inconsistent timeout/backoff behavior across agents.

### Hidden or Removed from MCP

Do not expose these as MCP tools:

- `watch`
- `live-reload prepare`
- `live-reload build`
- `live-reload attach`

`watch`, `prepare`, and `build` are low-level implementation or expert/debug surfaces, not canonical agent workflows. `live-reload attach` should be removed in favor of `live-reload discover` plus `live-reload status`.

## Public Surface Changes

### Live Reload

- Keep human/CLI lifecycle workflows:
  - `live-reload dev`
  - `live-reload status`
  - `live-reload discover`
- Keep MCP lifecycle workflows:
  - `gmloop_live_reload_dev`
  - `gmloop_live_reload_status`
  - `gmloop_live_reload_discover`
  - `gmloop_live_reload_wait_for_patch`
- Treat `gmloop_live_reload_wait_for_patch` as MCP automation-only synchronization, not a normal CLI workflow.
- Remove or hide from MCP:
  - `watch`
  - `live-reload prepare`
  - `live-reload build`
  - `live-reload attach`
- Remove `live-reload attach`; use `live-reload discover` plus `live-reload status` instead.

### Runner

- Replace runner action leaves:
  - Remove `runner start|stop|restart|pause|resume`.
  - Add `runner lifecycle <action>` where `action` is `start|stop|restart|pause|resume`.
- Keep:
  - `runner status`
  - `runner logs`
  - `runner clear-logs`
  - room controls

### Runtime

- Rename `runtime watch` to `runtime observe` to avoid confusion with file watching and live-reload watching.

### Validation

- Remove the generic `validate` command family.
- Use `project validate` for project readiness and integrity checks.
- Use `parse` for file syntax validation.
- Use `symbol inspect --kind <kind>` for resource, room, object, script, or symbol existence checks.

### Graph-Backed Read Tools

- Keep `graph search` for discovery.
- Make `symbol inspect <queryOrNodeId>` the catch-all inspector.
- Add `--kind auto|resource|script|room|object|symbol` for optional disambiguation.
- Add `--include node,context,neighbors,usages,dependents` with default `node`.
- Remove separate read-only leaves:
  - `resource inspect`
  - `resource deps`
  - `resource dependents`
  - `resource audit`
  - `script inspect`
  - `room inspect`
  - `object inspect`
  - `symbol context`
  - `symbol neighbors`
  - `symbol usages`

### Type-Specific Mutation and Structural Commands

Keep type-specific commands only where they own typed mutation or structural resource behavior, such as:

- object events
- room layers, cameras, and instances
- script add/remove/rename/duplicate/update, if those become real mutation workflows

Do not keep type-specific commands that only duplicate graph-backed read or inspection behavior.

## Implementation Changes

### Live Reload

- Update command registration so the human CLI surface only advertises:
  - `live-reload dev`
  - `live-reload status`
  - `live-reload discover`
- Remove `live-reload attach` from the command tree.
- Hide or remove low-level live-reload commands from MCP exposure:
  - `watch`
  - `live-reload prepare`
  - `live-reload build`
  - `live-reload attach`
- Keep `gmloop_live_reload_wait_for_patch` available to MCP as an automation-only synchronization tool.
- Implement `gmloop_live_reload_wait_for_patch` as a wait/poll wrapper around the running live-reload session's observable status state.
- Require or infer a baseline patch id where possible, then wait until the session reports a patch id newer than that baseline.
- Return structured timeout and no-session failures instead of making callers implement their own retry loops.
- Ensure the tool never applies patches or performs source mutations. It should only observe status and wait for the next reported patch.

### Symbol Inspection

- Update `src/cli/src/commands/symbol.ts` so `symbol inspect` resolves unknown input through semantic graph search.
- Return a discriminated payload with the detected kind.
- Support direct graph node id lookup.
- Support optional `--kind` filtering for ambiguous names.
- Support `--include node,context,neighbors,usages,dependents`, with default `node`.
- Produce structured failures for unresolved or ambiguous inputs.

### Command Registration and MCP Exposure

- Update command registration and MCP deny-list/allow-list behavior so MCP exposes only the reduced agent-facing leaves.
- Keep the live-reload MCP surface explicit so `gmloop_live_reload_wait_for_patch` remains available even though it is not a normal human CLI workflow.
- Remove placeholder or duplicate read-only command implementations rather than forwarding them to `symbol inspect`.
- Move trivial resource/object/room validation counts into `project inspect` or `project validate` evidence only if they provide real signal; otherwise delete them.

### Documentation

Update documentation to show the new canonical tool set and removed names:

- `src/mcp/README.md`
- `src/cli/README.md`
- command catalog docs

Docs should make the live-reload split explicit:

- Human CLI uses `live-reload dev`, `live-reload status`, and `live-reload discover`.
- MCP automation uses those same workflows plus `gmloop_live_reload_wait_for_patch`.
- `gmloop_live_reload_wait_for_patch` is for synchronization after file changes, not patch application.
- Agents should call `gmloop_live_reload_wait_for_patch` instead of hand-rolled polling against `status.lastPatchId`.

## Tests

### Command Catalog and MCP Surface

- Update command catalog tests to assert removed MCP tools are absent:
  - `watch`
  - `live-reload prepare`
  - `live-reload build`
  - `live-reload attach`
  - removed read-only inspection leaves
  - removed generic `validate` leaves
  - removed runner action leaves
- Assert canonical CLI commands are present:
  - `live-reload dev`
  - `live-reload status`
  - `live-reload discover`
  - `runner lifecycle <action>`
  - `runtime observe`
  - `project validate`
  - `parse`
  - `graph search`
  - `symbol inspect`
- Assert MCP live-reload tools are present:
  - `gmloop_live_reload_dev`
  - `gmloop_live_reload_status`
  - `gmloop_live_reload_discover`
  - `gmloop_live_reload_wait_for_patch`

### Live-Reload Wait-For-Patch

Add tests for `gmloop_live_reload_wait_for_patch`:

- waits until `status.lastPatchId` changes from the baseline
- returns immediately when a newer patch is already visible
- times out with a structured failure when no new patch appears
- returns a structured no-session failure when no live-reload session is discoverable
- does not call patch-apply or source-mutation paths
- uses consistent polling/backoff behavior so agents do not need to implement their own loops

### Symbol Inspect

Add tests for `symbol inspect` resolution:

- plain name resolves without the caller knowing the kind
- graph node id resolves directly
- `--kind` filters ambiguous results
- `--include` returns requested graph context only
- unresolved inputs produce structured failures
- ambiguous inputs produce structured failures with useful candidate data

### Runner and Runtime

- Update runner tests for `runner lifecycle <action>`.
- Update runtime tests for `runtime observe`.

### Validation Commands

- Update tests that used the generic `validate` family to use:
  - `project validate` for project readiness/integrity
  - `parse` for syntax validation
  - `symbol inspect --kind <kind>` for existence checks

### Validation Commands to Run

Run:

```bash
pnpm run build:ts
pnpm run lint:quiet
```

Then run targeted CLI/MCP tests affected by this surface change. Run the full test suite if targeted validation passes.

## Migration Notes

- Replace `live-reload attach` usage with `live-reload discover` followed by `live-reload status`.
- Replace agent polling loops against `status.lastPatchId` with `gmloop_live_reload_wait_for_patch`.
- Replace `runtime watch` with `runtime observe`.
- Replace `runner start|stop|restart|pause|resume` with `runner lifecycle <action>`.
- Replace generic `validate` usage with `project validate`, `parse`, or `symbol inspect --kind <kind>` depending on intent.
- Replace type-specific read-only inspection commands with `symbol inspect` and the appropriate `--kind`/`--include` options.

## Assumptions

- Breaking removal of old CLI/MCP names is acceptable because the repo explicitly disallows legacy shims.
- MCP should expose fewer, higher-level agent workflows.
- Low-level CLI-only expert commands may remain only when they perform distinct setup or debug tasks and are not exposed as canonical MCP workflows.
- `gmloop_live_reload_wait_for_patch` is worth keeping because it centralizes synchronization behavior that agents would otherwise reimplement poorly.
- `gmloop_live_reload_wait_for_patch` observes patch state only; it does not apply patches.
- `@gmloop/semantic` remains the owner of graph/search/context facts; CLI and MCP only orchestrate and shape outputs.
