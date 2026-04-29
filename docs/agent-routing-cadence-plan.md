# Enhanced Agent Routing And Cadence Design

## Summary

Move `.github/workflows/weights.json` from "pick one workflow, then pick any action agent" to an explicit scheduled routing policy that selects **workflow + agent** together. The routing model should stay flat and auditable: workflows declare their task type, weight, and complexity; agents declare the task types and complexity range they are allowed to run.

This replaces the earlier per-workflow agent maps, tag allowlists, and capability matching options with a smaller final schema based on three task types:

- `code`: normal scheduled code, lint, style, documentation, clarity, and maintenance workflows.
- `merging`: PR merge conflict repair workflows.
- `regressions`: PR test regression repair workflows.

All other scheduled work is assumed to be `code`. Do not introduce a general tag or capability system unless the routing policy grows beyond these three distinct task categories.

## Design Goals

- Keep `weights.json` concise enough to audit in one pass.
- Allow qwen-local to run low-complexity `code` workflows on a faster cadence.
- Keep merge conflict and test regression repair out of qwen-local unless explicitly enabled later.
- Preserve one shared hourly default action cadence for codex/copilot instead of dispatching once per enabled agent.
- Keep follow-up repair selection separate from scheduled task routing.
- Avoid compatibility shims, transitional routing paths, or duplicate scheduler logic.

## Weight File Shape

Use `version: 2` with four top-level concepts:

- `agents`: scheduled action agents, their global weights, cadence groups, task type eligibility, and optional complexity bounds.
- `agentPools.followUps`: non-scheduled follow-up pools for automerge/regression comments and PR repair flows.
- `scheduler`: fixed tick interval and shared cadence group dispatch budget.
- `workflows`: scheduled task workflow weights, task type, and complexity.

Sample `.github/workflows/weights.json`:

```json
{
  "version": 2,
  "agents": [
    {
      "name": "copilot",
      "weight": 1.0,
      "cadenceGroup": "default-actions",
      "cadenceMinutes": 60,
      "taskTypes": ["code", "merging", "regressions"],
      "minComplexity": 1
    },
    {
      "name": "codex",
      "weight": 0.0,
      "cadenceGroup": "default-actions",
      "cadenceMinutes": 60,
      "taskTypes": ["code", "merging", "regressions"],
      "minComplexity": 3
    },
    {
      "name": "qwen-local",
      "weight": 0.0,
      "cadenceGroup": "local-low-complexity",
      "cadenceMinutes": 30,
      "taskTypes": ["code"],
      "maxComplexity": 2
    }
  ],
  "agentPools": {
    "followUps": {
      "default": "copilot",
      "agents": [
        {"name": "copilot", "weight": 1.0},
        {"name": "codex", "weight": 0.0},
        {"name": "qwen-local", "weight": 0.0}
      ]
    }
  },
  "scheduler": {
    "tickMinutes": 15,
    "maxDispatchesPerCadenceGroup": 1
  },
  "workflows": [
    {
      "name": "agent-02-resolve-merge-conflicts",
      "weight": 1.0,
      "taskType": "merging",
      "complexity": 4
    },
    {
      "name": "agent-04-style",
      "weight": 0.2,
      "taskType": "code",
      "complexity": 1
    },
    {
      "name": "agent-10-documentation",
      "weight": 0.02,
      "taskType": "code",
      "complexity": 1
    },
    {
      "name": "agent-18-clarity",
      "weight": 0.25,
      "taskType": "code",
      "complexity": 2
    },
    {
      "name": "agent-23-lint",
      "weight": 0.33,
      "taskType": "code",
      "complexity": 1
    },
    {
      "name": "agent-36-docstrings",
      "weight": 0.05,
      "taskType": "code",
      "complexity": 1
    },
    {
      "name": "agent-84-document-intent",
      "weight": 0.02,
      "taskType": "code",
      "complexity": 1
    }
  ]
}
```

## Field Semantics

### Agents

- `name`: concrete value passed to workflow `agent` inputs.
- `weight`: global scheduled routing weight for the agent. Non-positive weights disable the agent for scheduled routing while still allowing its policy to be validated.
- `cadenceGroup`: shared dispatch budget key. Agents in the same group compete for the same due dispatch.
- `cadenceMinutes`: interval for the cadence group. Must be a positive multiple of `scheduler.tickMinutes`.
- `taskTypes`: task types this agent may run.
- `minComplexity`: optional inclusive lower bound.
- `maxComplexity`: optional inclusive upper bound.

At least one of `minComplexity` or `maxComplexity` may be omitted. Omitted lower bound means no minimum. Omitted upper bound means no maximum.

### Scheduler

- `tickMinutes`: fixed `_scheduler.yml` wake-up interval.
- `maxDispatchesPerCadenceGroup`: maximum scheduled task dispatches for each due cadence group on one scheduler tick.

The default expected value is `1`, so codex and copilot can share one hourly default action dispatch while qwen-local can use an independent 30-minute low-complexity dispatch.

### Workflows

- `name`: scheduled workflow name without the `.yml` suffix.
- `weight`: base task selection weight.
- `taskType`: one of `code`, `merging`, or `regressions`.
- `complexity`: integer task complexity score.

Complexity should describe routing risk and expected judgment, not runtime duration. Low-complexity workflows should be routine and recoverable. Merge repair, regression repair, architectural changes, broad refactors, and high-judgment tasks should receive higher complexity even when the workflow file itself is mechanically simple.

## Scheduler Behavior

- `_scheduler.yml` runs on a fixed 15-minute tick.
- The scheduler loads `weights.json`, validates the schema, and computes due cadence groups.
- For each due cadence group, the scheduler enumerates eligible workflow/agent pairs.
- A workflow/agent pair is eligible when:
  - `agent.weight > 0`
  - `workflow.weight > 0`
  - `workflow.taskType` is included in `agent.taskTypes`
  - `workflow.complexity >= agent.minComplexity` when `minComplexity` is present
  - `workflow.complexity <= agent.maxComplexity` when `maxComplexity` is present
  - `agent.cadenceGroup` is due on the current scheduler tick
- Candidate pair weight is:

```text
workflow.weight * agent.weight
```

- The scheduler dispatches the selected workflow with the selected concrete `agent` input.
- If a due cadence group has no eligible positive-weight workflow/agent pair, log and skip that group without failing the scheduler.

## Routing Policy

The intended initial policy is:

- `copilot`: enabled for `code`, `merging`, and `regressions`.
- `codex`: configured for `code`, `merging`, and `regressions`, but initially disabled with `weight: 0.0`.
- `qwen-local`: configured only for low-complexity `code`, initially disabled with `weight: 0.0` until the rollout is ready.

Do not route qwen-local into `merging` or `regressions` by complexity alone. Those task types are separate risk categories and must be explicitly listed in `qwen-local.taskTypes` before qwen-local can receive them.

## Follow-Up Pools

Keep follow-up selection separate from scheduled action routing.

`agentPools.followUps` remains the policy source for follow-up repair flows such as automerge comments, regression comments, and PR-specific retry paths. Those flows may reuse the same agent names, but they are not selected by the scheduled cadence algorithm.

Manual `workflow_dispatch.inputs.agent` overrides should remain available to humans. Scheduled routing restrictions apply to automated scheduler selection, not to explicit human overrides.

## Validation

Scheduler parsing should fail clearly when the configuration is internally inconsistent:

- `version` must be `2`.
- Agent names must be unique.
- Workflow names must be unique.
- Agent and workflow weights must be finite numbers.
- Scheduled agent records must have `name`, `weight`, `cadenceGroup`, `cadenceMinutes`, and non-empty `taskTypes`.
- Workflow records must have `name`, `weight`, `taskType`, and `complexity`.
- `taskType` and `taskTypes` values must be one of `code`, `merging`, or `regressions`.
- `complexity`, `minComplexity`, and `maxComplexity` must be integers.
- `minComplexity` must be less than or equal to `maxComplexity` when both are present.
- `cadenceMinutes` must be a positive multiple of `scheduler.tickMinutes`.
- Agents sharing a `cadenceGroup` must use the same `cadenceMinutes`.
- `scheduler.maxDispatchesPerCadenceGroup` must be a positive integer.
- Non-positive agent and workflow weights should be ignored during selection, not treated as validation failures.

Validation should also include an explicit guard that qwen-local has no eligible `merging` or `regressions` route unless that route is intentionally added later.

## Implementation Notes

- Update `_agent-open-pr-and-ping.yml` so manual blank-agent dispatch can still choose from `weights.json`, but scheduled dispatch should already pass a concrete agent.
- Update `_scheduler.yml` to parse cadence groups from `agents`, not lane definitions.
- Keep the selection algorithm in one scheduler implementation path. Do not preserve separate version 1 routing behavior once version 2 is adopted.
- Preserve manual human overrides for workflow dispatch.
- Do not add tags, capabilities, lane allowlists, or per-workflow agent maps unless the routing requirements become more specific than the three task types.

## Test Plan

Update `test/agent-weight-routing.test.ts` to assert:

- `weights.json` is version 2.
- Every scheduled workflow declares `taskType` and `complexity`.
- Every scheduled agent declares `taskTypes`, `cadenceGroup`, and `cadenceMinutes`.
- The only valid task types are `code`, `merging`, and `regressions`.
- qwen-local is eligible only for low-complexity `code` workflows.
- qwen-local has no eligible route to `merging` or `regressions`.
- codex/copilot share the `default-actions` cadence group.
- qwen-local uses a separate `local-low-complexity` cadence group.
- Cadence intervals are multiples of `scheduler.tickMinutes`.
- Non-positive weights disable candidates without invalidating the file.
- Follow-up pools remain separate from scheduled action routing.

Add or extend workflow tests for `_scheduler.yml` to assert:

- The scheduler parses cadence groups from agent records.
- Due cadence groups dispatch independently on the same scheduler tick.
- Agents in the same cadence group share the configured dispatch budget.
- The dispatch payload includes the selected concrete `agent`.
- Candidate weights combine workflow and agent weights.
- Complexity bounds filter eligible pairs before weighted selection.
- Task type eligibility filters pairs before weighted selection.

Run:

- `pnpm run build:ts`
- targeted root workflow tests
- `pnpm run lint:quiet`

## Assumptions

- "Actions" means scheduled task workflows like `agent-23-lint`, not GitHub marketplace actions.
- qwen-local should initially run every 30 minutes for low-complexity `code` tasks once enabled.
- Normal codex/copilot scheduled action cadence should remain hourly.
- Manual human overrides remain allowed.
- The allowlist is for automated scheduled routing.
