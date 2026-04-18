# Enhanced Agent Routing And Cadence Design

## Summary

Move `.github/workflows/weights.json` from “pick one workflow, then pick any action agent” to an explicit scheduled routing policy that selects **workflow + agent** together. Use per-workflow agent weights to restrict qwen-local to low-complexity task workflows, and add cadence lanes so qwen-local can run more often than the normal hourly action cadence.

## Key Changes

- Upgrade `.github/workflows/weights.json` to `version: 2` with three top-level concepts:
  - `workflows`: each task workflow keeps its base task weight and adds an `agents` map, e.g. `"agents": {"codex": 1, "copilot": 1, "qwen-local": 2}`.
  - `agentPools.followUps`: keep the existing follow-up pool for automerge/regression comments.
  - `scheduler.lanes`: define cadence-specific lanes, e.g. a default hourly lane and a qwen-local low-complexity lane.
- Initial qwen-local allowlist is explicit via per-workflow `agents` entries only on:
  - `agent-23-lint`
  - `agent-04-style`
  - `agent-10-documentation`
  - `agent-18-clarity`
  - `agent-36-docstrings`
  - `agent-84-document-intent`
- Default behavior:
  - Workflows without an `agents.qwen-local` entry can never be selected for qwen-local by scheduled routing.
  - qwen-local receives higher per-workflow weight within its allowed task set.
  - codex/copilot continue using the broader default action lane.

## Scheduler Behavior

- Change `_scheduler.yml` to run on a fixed 15-minute tick, using `weights.json` to decide which cadence lanes are due.
- Scheduler dispatches at most one task per due lane:
  - `default-actions`: every 60 minutes, selects from normal workflows and codex/copilot weights.
  - `qwen-local-low-complexity`: every 30 minutes, selects only workflows where `agents.qwen-local > 0`.
- Scheduler dispatches the selected workflow with the existing `agent` input set to the selected agent, so downstream workflows do not need to re-randomize the agent.
- Candidate pair weight is `workflow.weight * workflow.agents[agent]`.
- If a lane has no eligible positive-weight workflow/agent pair, log and skip that lane without failing the scheduler.

## Implementation Notes

- Update `_agent-open-pr-and-ping.yml` so manual blank-agent dispatch can still choose from `weights.json`, but scheduled dispatch should already pass a concrete agent.
- Preserve manual `workflow_dispatch.inputs.agent` overrides for humans; scheduled restrictions apply to automated routing.
- Keep follow-up selection in `agent-02-resolve-merge-conflicts.yml` and `automerge-prs.yml` on `agentPools.followUps`; do not route qwen-local into follow-up repair unless explicitly added later.
- Add validation in scheduler parsing:
  - reject unknown workflow names in scheduler lanes,
  - ignore non-positive weights,
  - normalize agent names consistently,
  - require cadence intervals to be multiples of the 15-minute scheduler tick.

## Test Plan

- Update `test/agent-weight-routing.test.ts` to assert:
  - `weights.json` is version 2.
  - qwen-local only appears in the approved low-complexity workflow agent maps.
  - default lane excludes qwen-local unless explicitly configured.
  - qwen-local lane includes only workflows with positive `agents.qwen-local`.
  - follow-up pools remain separate from scheduled action routing.
- Add or extend workflow tests for `_scheduler.yml`:
  - scheduler parses lanes from `weights.json`,
  - dispatch payload includes the selected `agent`,
  - candidate weights combine workflow and per-agent weights,
  - due lanes can dispatch independently on the same scheduler tick.
- Run:
  - `pnpm run build:ts`
  - targeted root workflow tests
  - `pnpm run lint:quiet`

## Assumptions

- “Actions” means scheduled task workflows like `agent-23-lint`, not GitHub marketplace actions.
- qwen-local should initially run every 30 minutes for low-complexity tasks.
- Normal codex/copilot scheduled action cadence should remain hourly.
- Manual human overrides remain allowed; the allowlist is for automated scheduled routing.
