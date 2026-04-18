# Enhanced Agent Routing And Cadence Design

## Summary

Move `.github/workflows/weights.json` from “pick one workflow, then pick any action agent” to an explicit scheduled routing policy that selects **workflow + agent** together. Use per-workflow agent weights to restrict qwen-local to low-complexity task workflows, and add cadence lanes so qwen-local can run more often than the normal hourly action cadence.

## Evaluation

The current per-workflow agent map is a good first step because it is explicit, easy to validate, and makes qwen-local's allowlist obvious. It also keeps the scheduler's selection math simple: build workflow/agent pairs, discard non-positive entries, then weight by workflow and agent weights.

The weakness is duplication. Every time a new low-complexity agent is introduced, the same agent list has to be repeated across many workflows. Every time a workflow changes from low to medium complexity, every lane and workflow-agent map that mentions it needs to be revisited. This is acceptable for the first qwen-local rollout, but it will not scale well once routing policy needs to reason about several agents, task categories, and complexity bands.

Recommendation: treat the per-workflow agent map as **Option A** because it is lowest-risk and easiest to ship first. If the implementation can tolerate one extra grouping layer, **Option B** is the best practical next schema because it removes most duplication without introducing capability inference. Keep **Option C** as the more expressive task/capability design if the routing table starts reasoning about many agents, task categories, and complexity bands.

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

## Option A: Per-Workflow Agent Weights

This is the existing plan. Each workflow names the agents that may run it. Absence means denial, so qwen-local is allowed only where it is explicitly listed.

Sample `.github/workflows/weights.json`:

```json
{
  "version": 2,
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
    "lanes": [
      {
        "name": "default-actions",
        "cadenceMinutes": 60,
        "agents": ["codex", "copilot"],
        "workflows": "all"
      },
      {
        "name": "qwen-local-low-complexity",
        "cadenceMinutes": 30,
        "agents": ["qwen-local"],
        "workflows": [
          "agent-04-style",
          "agent-10-documentation",
          "agent-18-clarity",
          "agent-23-lint",
          "agent-36-docstrings",
          "agent-84-document-intent"
        ]
      }
    ]
  },
  "workflows": [
    {
      "name": "agent-02-resolve-merge-conflicts",
      "weight": 1.0,
      "agents": {
        "codex": 1.0,
        "copilot": 1.0
      }
    },
    {
      "name": "agent-04-style",
      "weight": 0.2,
      "agents": {
        "codex": 1.0,
        "copilot": 1.0,
        "qwen-local": 2.0
      }
    },
    {
      "name": "agent-10-documentation",
      "weight": 0.02,
      "agents": {
        "codex": 1.0,
        "copilot": 1.0,
        "qwen-local": 2.0
      }
    },
    {
      "name": "agent-18-clarity",
      "weight": 0.25,
      "agents": {
        "codex": 1.0,
        "copilot": 1.0,
        "qwen-local": 2.0
      }
    },
    {
      "name": "agent-23-lint",
      "weight": 0.33,
      "agents": {
        "codex": 1.0,
        "copilot": 1.0,
        "qwen-local": 3.0
      }
    },
    {
      "name": "agent-36-docstrings",
      "weight": 0.05,
      "agents": {
        "codex": 1.0,
        "copilot": 1.0,
        "qwen-local": 2.0
      }
    },
    {
      "name": "agent-84-document-intent",
      "weight": 0.02,
      "agents": {
        "codex": 1.0,
        "copilot": 1.0,
        "qwen-local": 2.0
      }
    }
  ]
}
```

Selection rule:

1. Find due lanes.
2. For each due lane, enumerate workflow/agent pairs allowed by both the lane and `workflows[*].agents`.
3. Drop pairs with non-positive workflow or agent weight.
4. Select by `workflow.weight * workflow.agents[agent]`.
5. Dispatch the selected workflow with the selected concrete `agent` input.

Option A is the best immediate migration path because it is compatible with the existing `workflows` array and makes the qwen-local deny-by-default policy visually obvious.

## Option B: Agent Classes With Workflow Tags

This option is a condensed middle ground. Workflows declare a small set of `tags`, agents declare which tags they can run, and cadence remains agent-specific. It avoids repeating `codex`, `copilot`, and `qwen-local` under every workflow, but it does not require the richer task capability and cognitive-complexity model.

Sample `.github/workflows/weights.json`:

```json
{
  "version": 2,
  "agents": {
    "codex": {
      "weight": 1.0,
      "cadence": {"group": "default-actions", "minutes": 60},
      "includeTags": ["default"],
      "excludeTags": []
    },
    "copilot": {
      "weight": 1.0,
      "cadence": {"group": "default-actions", "minutes": 60},
      "includeTags": ["default"],
      "excludeTags": []
    },
    "qwen-local": {
      "weight": 1.5,
      "cadence": {"group": "local-low-complexity", "minutes": 30},
      "includeTags": ["low-complexity"],
      "excludeTags": ["needs-human-judgment", "large-refactor", "merge-repair"]
    }
  },
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
    {"name": "agent-02-resolve-merge-conflicts", "weight": 1.0, "tags": ["default", "merge-repair"]},
    {"name": "agent-04-style", "weight": 0.2, "tags": ["default", "low-complexity"]},
    {"name": "agent-10-documentation", "weight": 0.02, "tags": ["default", "low-complexity"]},
    {"name": "agent-18-clarity", "weight": 0.25, "tags": ["default", "low-complexity"]},
    {"name": "agent-23-lint", "weight": 0.33, "tags": ["default", "low-complexity"]},
    {"name": "agent-36-docstrings", "weight": 0.05, "tags": ["default", "low-complexity"]},
    {"name": "agent-39-refactor-performance", "weight": 1.0, "tags": ["default", "large-refactor"]},
    {"name": "agent-84-document-intent", "weight": 0.02, "tags": ["default", "low-complexity"]}
  ]
}
```

Eligibility rule:

1. A workflow is eligible for an agent when its tags overlap with `agent.includeTags`.
2. A workflow is rejected for an agent when any workflow tag appears in `agent.excludeTags`.
3. An agent is due when its `agent.cadence.minutes` interval has elapsed on the scheduler tick.
4. Agents with the same `agent.cadence.group` share a dispatch budget.
5. Pair weight is `workflow.weight * agent.weight`.

Option B is simpler than Option A once several workflows share the same qwen-local eligibility. It also keeps the config easy to audit: qwen-local's entire routing policy is in one agent record, and each workflow only needs a short tag list.

The tradeoff is that tags are less precise than full task requirements. `low-complexity` is easy to understand, but it needs disciplined use. Validation should reject unknown tags, require every workflow to include at least one tag, and verify qwen-local has no route to workflows tagged `merge-repair`, `large-refactor`, or `needs-human-judgment`.

## Option C: Task Requirements Matched To Agent Capabilities

Instead of listing each agent under every workflow, define the task's requirements once and define each agent's capabilities once. The scheduler then matches eligible pairs by capability tags and cognitive-complexity limits.

This avoids repeated agent maps and makes policy changes less scattered. For example, qwen-local can be granted all `lint` and `documentation` tasks up to complexity 2 without adding `qwen-local` to every lint/documentation workflow.

Sample `.github/workflows/weights.json`:

```json
{
  "version": 2,
  "agentPools": {
    "followUps": {
      "default": "copilot",
      "agents": [
        {"name": "copilot", "weight": 1.0, "cadence": 60, "complexity": 4},
        {"name": "codex", "weight": 0.0, "cadence": 60, "complexity": 4},
        {"name": "qwen-local", "weight": 0.0, "cadence": 30, "complexity": 2}
      ]
    }
  },
  "scheduler": {
    "tickMinutes": 15
  },
  "workflows": [
    {
      "name": "agent-02-resolve-merge-conflicts",
      "weight": 1.0,
      "complexity": 4
    },
    {
      "name": "agent-04-style",
      "weight": 0.2,
      "complexity": 1
    },
    {
      "name": "agent-10-documentation",
      "weight": 0.02,
      "complexity": 1
    },
    {
      "name": "agent-18-clarity",
      "weight": 0.25,
      "complexity": 2
    }
  ]
}
```

Eligibility rule:

1. A workflow is eligible for an agent when every `workflow.task.capabilities` entry is present in `agent.capabilities`.
2. `workflow.task.complexity` must be less than or equal to `agent.cognitiveComplexity.max`.
3. An agent is due when its `agent.cadence.minutes` interval has elapsed on the scheduler tick.
4. Agents with the same `agent.cadence.group` share a dispatch budget. With `maxDispatchesPerCadenceGroup: 1`, codex and copilot still produce one normal action dispatch per hour between them, while qwen-local can produce one low-complexity dispatch every 30 minutes.
5. Pair weight is `workflow.weight * agent.weight`, with optional group-specific multipliers added later only if there is a concrete need.

Option C is better once the policy grows beyond qwen-local because adding a new agent usually requires editing only `agents`, not every workflow. It also expresses intent more directly: tasks describe what they need, and agents describe what they can safely handle.

The tradeoff is that validation matters more. The scheduler should reject unknown capability names, require every workflow to declare task requirements, and fail clearly if a due cadence group has no eligible pairs because of an overly strict complexity bound.

## Implementation Notes

- Update `_agent-open-pr-and-ping.yml` so manual blank-agent dispatch can still choose from `weights.json`, but scheduled dispatch should already pass a concrete agent.
- Preserve manual `workflow_dispatch.inputs.agent` overrides for humans; scheduled restrictions apply to automated routing.
- Keep follow-up selection in `agent-02-resolve-merge-conflicts.yml` and `automerge-prs.yml` on `agentPools.followUps`; do not route qwen-local into follow-up repair unless explicitly added later.
- Add validation in scheduler parsing:
  - reject unknown workflow names in scheduler lanes if Option A is used,
  - reject unknown tags if Option B is used,
  - reject unknown capability names if Option C is used,
  - ignore non-positive weights,
  - normalize agent names consistently,
  - require lane or agent cadence intervals to be multiples of the 15-minute scheduler tick.

## Test Plan

- Update `test/agent-weight-routing.test.ts` to assert:
  - `weights.json` is version 2.
  - qwen-local only appears in the approved low-complexity workflow agent maps.
  - default lane excludes qwen-local unless explicitly configured.
  - qwen-local lane includes only workflows with positive `agents.qwen-local`.
  - follow-up pools remain separate from scheduled action routing.
- If Option B is selected instead, update `test/agent-weight-routing.test.ts` to assert:
  - every workflow has a non-empty `tags` list,
  - every scheduled agent has `includeTags`, `excludeTags`, `cadence.group`, `cadence.minutes`, and positive weight,
  - qwen-local includes only `low-complexity` workflows and excludes `merge-repair`, `large-refactor`, and `needs-human-judgment`,
  - codex/copilot remain eligible for the broader `default` workflow set,
  - cadence-group timing remains independent from task tagging.
- If Option C is selected instead, update `test/agent-weight-routing.test.ts` to assert:
  - each workflow has `task.capabilities` and `task.complexity`,
  - each scheduled agent has `capabilities`, `cognitiveComplexity.max`, `cadence.group`, `cadence.minutes`, and positive weight,
  - qwen-local is eligible only for low-complexity lint/documentation/style/clarity workflows,
  - high-complexity workflows such as merge conflicts, architectural audits, and hot refactors are not eligible for qwen-local,
  - cadence-group timing remains independent from task eligibility.
- Add or extend workflow tests for `_scheduler.yml`:
  - scheduler parses lanes or cadence groups from `weights.json`,
  - dispatch payload includes the selected `agent`,
  - candidate weights combine workflow and per-agent weights,
  - due lanes or cadence groups can dispatch independently on the same scheduler tick.
- Run:
  - `pnpm run build:ts`
  - targeted root workflow tests
  - `pnpm run lint:quiet`

## Assumptions

- “Actions” means scheduled task workflows like `agent-23-lint`, not GitHub marketplace actions.
- qwen-local should initially run every 30 minutes for low-complexity tasks.
- Normal codex/copilot scheduled action cadence should remain hourly.
- Manual human overrides remain allowed; the allowlist is for automated scheduled routing.
