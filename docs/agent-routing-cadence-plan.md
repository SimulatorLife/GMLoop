# Enhanced Agent Routing And Cadence Design

## Summary

Revise `.github/workflows/weights.json` from a two-step scheduled policy of "pick one workflow, then let that workflow choose any action agent" to a single scheduled routing policy that selects **workflow + agent** together.

The revised design keeps the current repo split intact:

- scheduled action routing is separate from follow-up routing
- manual `agent` overrides remain available to humans
- scheduled selection becomes a concrete workflow/agent pair chosen by the scheduler
- the policy names actual repo agents consistently: `copilot`, `codex`, `qwen`, `gemini`, and `mini-max`

The routing model stays flat and auditable. Scheduled workflows declare task type, base weight, and complexity. Scheduled agents declare their own weight, cadence, task-type eligibility, and optional complexity bounds.

Only three scheduled task categories exist:

- `code`: normal scheduled code, lint, style, documentation, clarity, and maintenance workflows
- `merging`: PR merge-conflict repair workflows
- `regressions`: PR test-regression repair workflows

Do not add tags, capabilities, lane allowlists, or per-workflow agent maps unless the routing policy grows beyond these three categories.

## Final Config Shape

Use one authoritative schema in `.github/workflows/weights.json`:

- `agents`: scheduled action agents used only by the scheduler and manual blank-agent action dispatch fallback
- `agentPools.followUps`: non-scheduled follow-up pools for automerge, regression comments, conflict-repair follow-ups, and similar PR-specific retry flows
- `workflows`: scheduled task workflow weights and routing metadata

Scheduled action routing does **not** keep `agentPools.actions` in the final schema. The old action-pool path is removed rather than preserved in parallel.

Sample `.github/workflows/weights.json`:

```json
{
  "agents": [
    {
      "name": "copilot",
      "weight": 1.0,
      "category": ["code", "merging", "regressions"]
    },
    {
      "name": "codex",
      "weight": 1.0,
      "cadenceTicks": 4,
      "category": ["code"],
      "minComplexity": 3
    },
    {
      "name": "qwen",
      "weight": 0.0,
      "cadenceTicks": 2,
      "category": ["code"],
      "maxComplexity": 2
    },
    {
      "name": "gemini",
      "weight": 0.0,
      "cadenceTicks": 4,
      "category": ["code"],
      "maxComplexity": 2
    },
    {
      "name": "mini-max",
      "weight": 0.5,
      "cadenceTicks": 4,
      "category": ["code"],
      "maxComplexity": 2
    }
  ],
  "agentPools": {
    "followUps": {
      "default": "copilot",
      "agents": [
        {"weight": 0, "name": "codex"},
        {"weight": 1, "name": "copilot"},
        {"weight": 0, "name": "gemini"}
      ]
    }
  },
  "workflows": [
    {
      "name": "agent-02-resolve-merge-conflicts",
      "weight": 1.0,
      "category": "merging",
      "complexity": 3
    },
    {
      "name": "agent-04-style",
      "weight": 0.2,
      "category": "code",
      "complexity": 1
    },
    {
      "name": "agent-18-clarity",
      "weight": 0.25,
      "category": "code",
      "complexity": 2
    },
    {
      "name": "agent-23-lint",
      "weight": 0.33,
      "category": "code",
      "complexity": 3
    },
    {
      "name": "agent-41-test-failure",
      "weight": 0.5,
      "category": "regressions",
      "complexity": 3
    }
  ]
}
```

Field semantics:

- `agents[*].name`: concrete value passed to workflow `agent` inputs
- `agents[*].weight`: scheduled routing weight for the agent; non-positive weights disable scheduled selection without invalidating the file
- `agents[*].cadenceTicks`: optional positive integer count of scheduler ticks between due evaluations for that agent; defaults to `1` when omitted
- `agents[*].category`: non-empty list of allowed scheduled task categories
- `agents[*].minComplexity`: optional inclusive lower complexity bound
- `agents[*].maxComplexity`: optional inclusive upper complexity bound
- `workflows[*].name`: scheduled workflow name without the `.yml` suffix
- `workflows[*].weight`: base task-selection weight
- `workflows[*].category`: one of `code`, `merging`, or `regressions`
- `workflows[*].complexity`: required integer routing-complexity score in the inclusive range `1..3`

Complexity is mandatory on every scheduled workflow in the final schema. Do not rely on implicit defaults.

Complexity represents routing risk and expected judgment, not runtime duration. Use only three levels:

- `1`: low-complexity routine and recoverable work
- `2`: normal medium-complexity work
- `3`: highest-complexity scheduled work

Merge repair, regression repair, broad refactors, and high-judgment maintenance tasks should use `3` rather than expanding the scale further.

## Routing Semantics

`_scheduler.yml` continues to run on its fixed 15-minute cron. That wake-up interval remains owned by the workflow file itself rather than duplicated in `weights.json`.

The scheduler loads `weights.json`, validates the final schema, and computes eligible workflow/agent pairs for the current tick.

An agent is due on a scheduler tick when:

```text
currentTickNumber % (agent.cadenceTicks ?? 1) === 0
```

A workflow/agent pair is eligible when:

- `agent.weight > 0`
- `workflow.weight > 0`
- the agent is due on the current scheduler tick
- `workflow.category` is included in `agent.category`
- `workflow.complexity >= agent.minComplexity` when `minComplexity` is present
- `workflow.complexity <= agent.maxComplexity` when `maxComplexity` is present

Candidate pair weight is:

```text
workflow.weight * agent.weight
```

Selection remains deterministic and uses the same general run-number weighted cycle approach the repo already uses today:

- use `GITHUB_RUN_NUMBER` as the selection input
- build the candidate set only after cadence and eligibility filtering
- sort deterministically before building the weighted cycle
- select the candidate pair by deterministic weighted cycle position

The same config, candidate set, and `GITHUB_RUN_NUMBER` must always produce the same selected workflow/agent pair.

The scheduler dispatches exactly one eligible workflow/agent pair per run, preserving one shared scheduled dispatch surface while still allowing faster due evaluation for agents with shorter cadence.

If a scheduler tick has no eligible positive-weight workflow/agent pair, log and skip without failing the scheduler.

Manual and follow-up behavior:

- Manual `workflow_dispatch.inputs.agent` remains an unrestricted human override.
- Blank manual dispatch in `_agent-open-pr-and-ping.yml` must still resolve through the scheduled `agents` policy source defined in `weights.json`.
- `agentPools.followUps` remains the only policy source for automerge comments, regression comments, conflict-repair follow-ups, and similar PR-specific retry paths.
- Scheduled restrictions apply only to automated scheduler selection and blank manual fallback selection, not to explicit human overrides.

## Policy Defaults

Initial intended policy:

- `copilot`: enabled for `code`, `merging`, and `regressions`; omitting `cadenceTicks` keeps it on the default every-run cadence
- `codex`: enabled for higher-complexity `code` work on the standard hourly cadence
- `qwen`: reserved for low-complexity `code` work on a faster 30-minute cadence, initially disabled with `weight: 0.0` until rollout is ready
- `gemini`: retained as a named repo agent, but disabled for scheduled routing initially with `weight: 0.0`
- `mini-max`: retained in scheduled routing as a low-complexity `code` option rather than silently removed

Cadence defaults under the fixed 15-minute scheduler tick:

- `cadenceTicks: 4` -> every 60 minutes
- `cadenceTicks: 2` -> every 30 minutes
- omitted `cadenceTicks` -> every scheduler run

This document does **not** introduce a `qwen-local` scheduled identity. The repo’s existing local-Qwen identity is `qwen`, and the routing plan should continue to use that name unless a separate rename proposal is approved later.

## Validation Rules

Scheduler parsing should fail clearly when the configuration is internally inconsistent:

- scheduled agent names must be unique
- workflow names must be unique
- scheduled agent and workflow weights must be finite numbers
- scheduled agent records must have `name`, `weight`, and non-empty `category`
- workflow records must have `name`, `weight`, `category`, and `complexity`
- `category` values must be one of `code`, `merging`, or `regressions`
- `complexity`, `minComplexity`, and `maxComplexity` must be integers in the inclusive range `1..3`
- `cadenceTicks`, when present, must be an integer
- `cadenceTicks`, when present, must be positive
- `minComplexity` must be less than or equal to `maxComplexity` when both are present
- follow-up pools must continue to satisfy the existing weighted-agent pool shape used by current non-scheduled workflows
- non-positive scheduled agent and workflow weights should be ignored during selection, not treated as validation failures

Validation should also include explicit policy guards for intentionally restricted scheduled agents:

- `qwen` must have no eligible `merging` or `regressions` route unless intentionally added later
- `gemini` must have no eligible `merging` or `regressions` route unless intentionally added later
- any future removal of `mini-max` from scheduled routing must be expressed as an explicit config change, not a silent omission from the document

## Migration Impact

This document describes a real schema migration from the repo’s current scheduler shape, so the implementation notes must stay explicit about affected surfaces.

Conceptual files affected:

- `.github/workflows/_scheduler.yml`
- `.github/workflows/_agent-open-pr-and-ping.yml`
- `test/agent-weight-routing.test.ts`

Required migration changes:

- update `_scheduler.yml` to load scheduled agents from top-level `agents`, enumerate eligible workflow/agent pairs, and dispatch the selected concrete `agent`
- update `_agent-open-pr-and-ping.yml` so blank manual action dispatch selects from scheduled `agents` instead of the removed `agentPools.actions`
- preserve `agentPools.followUps` behavior in follow-up workflows such as automerge and conflict-repair flows
- remove old scheduled action-pool routing logic rather than keeping parallel legacy paths
- keep manual explicit `agent` overrides intact for human-triggered runs

This plan intentionally preserves follow-up routing as a separate policy surface. It does **not** redesign non-scheduled follow-up flows beyond keeping them compatible with the updated weight file.

## Test Plan

Update `test/agent-weight-routing.test.ts` and related workflow tests to assert:

- schema validation checks only the final field set described in this document
- the only valid scheduled task categories are `code`, `merging`, and `regressions`
- workflow `complexity` is required on every scheduled workflow
- workflow and agent complexity values are limited to `1..3`
- non-positive weights disable candidates without invalidating the file
- scheduled routing remains separate from `agentPools.followUps`
- deterministic pair selection remains based on `GITHUB_RUN_NUMBER`
- candidate pair weights combine `workflow.weight * agent.weight`
- cadence filtering uses `cadenceTicks`
- complexity bounds filter eligible pairs before weighted selection
- task-category eligibility filters eligible pairs before weighted selection
- the scheduler dispatch payload includes the selected concrete `agent`
- manual explicit `agent` override bypasses scheduled eligibility rules
- blank manual dispatch still selects from the scheduled `agents` policy source
- `qwen` has no eligible `merging` or `regressions` route unless intentionally enabled later
- `gemini` has no eligible `merging` or `regressions` route unless intentionally enabled later

Run after implementation:

- targeted root workflow tests
- `pnpm run build:ts`
- `pnpm run lint:quiet`

## Assumptions And Defaults

- the current repo shape is the source of truth unless this document explicitly proposes a migration
- `qwen` is the existing local-Qwen identity in the repo and remains the default name used by this plan
- `agentPools.followUps` stays as-is unless there is a strong reason to redesign non-scheduled routing too
- the scheduler remains a fixed 15-minute tick
- deterministic weighted selection remains the default because current workflows and tests already rely on it
- "actions" in this document means scheduled task workflows such as `agent-23-lint`, not GitHub marketplace actions
