# Agent Routing Weights

Agent and workflow scheduling weights live in `.github/workflows/weights.json`.

The file separates workflow selection from agent selection:

- `workflows` controls which scheduled agent workflow `_scheduler.yml` dispatches.
- `agentPools.actions` controls the initial implementation agent mentioned when a workflow opens a new PR.
- `agentPools.followUps` controls follow-up repair agents for PR regressions and merge conflicts.

Each agent pool has a `default` and an `agents` array. Entries with non-positive or non-finite weights are ignored during weighted selection, so a zero weight keeps an agent documented but disabled. If a pool has no eligible weighted entries, the workflow falls back to that pool's `default`.

Manual workflow `agent` inputs still take precedence over weighted selection. Follow-up routing intentionally does not reuse the PR branch prefix; it selects independently from `agentPools.followUps`.
