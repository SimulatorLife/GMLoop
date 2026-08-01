# Codex `smart` agent

The `smart` agent is a costly, high-intelligence specialist for complex,
high-judgment assignments. It uses GPT-5.6 Sol with high reasoning and should
be dispatched sparingly, only when the quality benefit justifies the additional
usage. Routine exploration, simple edits, and ordinary validation belong to
the normal worker, explorer, or validator roles.

It is configured in
[`.codex/agents/smart.toml`](../.codex/agents/smart.toml) and registered in
[`.codex/config.toml`](../.codex/config.toml) under `[agents.smart]`.

## Capabilities

The role intentionally does not override `sandbox_mode`, `approval_policy`,
`mcp_servers`, or tool settings. It therefore inherits the main/orchestrator
agent's full shell, filesystem, MCP, approval, and network capabilities for
the assigned task. Its only capability restriction is that it cannot spawn
subagents.

## No-subagent boundary

The role sets `[agents] max_depth = 0`, `[features] multi_agent = false`, and
`enable_fanout = false`. These configuration guards prevent it from creating
child-agent threads or fan-out work. Its developer instructions also explicitly
forbid `spawn_agent`, `spawn_agents_on_csv`, delegation, and child agents.

The parent orchestrator can dispatch `smart` directly; the zero depth applies
to further descendants created from the smart role, not to the parent's direct
dispatch.

## Configuration contract

| Setting | Value |
| --- | --- |
| `name` | `"smart"` |
| `model` | `"gpt-5.6-sol"` |
| `model_reasoning_effort` | `"high"` |
| `sandbox_mode` | inherited from the orchestrator |
| `approval_policy` | inherited from the orchestrator |
| `mcp_servers` | inherited from the orchestrator |
| `[agents].max_depth` | `0` |
| `[features].multi_agent` | `false` |
| `[features].enable_fanout` | `false` |
| `model_provider` | *(unset — inherit the orchestrator provider)* |

Use the role only for assignments with substantial ambiguity, architectural
judgment, difficult debugging, or other work where the highest reasoning tier
is warranted. The agent works directly and reports its result or blocker to
the orchestrator without delegating.
