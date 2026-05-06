---
name: mcp-server-workflows
description: Use this skill when working on MCP server tools, tool schemas, AI-agent workflow APIs, structured tool outputs, or exposing GMLoop capabilities to external agents.
---

# MCP Server Workflows Skill

## Purpose

Use this skill when an agent is changing the MCP workspace or agent-facing tool APIs.

The MCP target state is a clean automation layer for AI agents building and maintaining GameMaker games:

- expose GMLoop capabilities as typed, discoverable tools
- return compact, structured, actionable results
- preserve workspace ownership by delegating domain behavior
- support parser, lint, format, semantic, refactor, graph, and hot-reload workflows
- avoid turning MCP tools into a parallel application architecture

This skill appears once even if requested more than once; one broad MCP workflow skill covers the duplicated request.

## Ownership

MCP owns:

- server registration and lifecycle
- tool names, descriptions, inputs, and outputs
- agent-facing workflow composition
- structured result payloads
- error shaping for tool consumers
- permission-conscious access to repository capabilities

MCP does not own:

- parser grammar
- formatter logic
- lint rule implementation
- semantic index internals
- codemod planning
- transpiler emission
- CLI command parsing unless the tool intentionally shells through the CLI as a contract

Domain behavior belongs in the owning workspace. MCP should expose it, not reimplement it.

## Working Approach

Before editing an MCP tool:

1. Identify the user or agent workflow the tool enables.
2. Confirm the domain capability already exists or belongs in another workspace first.
3. Design a small typed input schema and structured output payload.
4. Define error cases, partial results, and large-output handling.
5. Add tests for schema validation, success output, and failure output.

Implementation should:

- keep tool schemas explicit and narrow
- use stable identifiers for files, symbols, rules, resources, and edits
- return summaries plus references instead of huge raw dumps
- delegate to public workspace APIs
- keep results deterministic for repeated agent runs
- avoid hidden global state across tool calls

## Agent-Centered Tool Design

MCP tools should help agents act correctly with limited context.

- Include enough provenance for source files, ranges, rules, symbols, and resource metadata.
- Prefer ranked or filtered context over full-project output.
- Return diagnostics and proposed next actions in structured fields.
- Make write tools explicit about dry-run versus apply behavior.
- Provide concise error messages with machine-readable reason codes where useful.
- Avoid making agents parse human prose to recover important data.

## Safety And Boundaries

Tool boundaries should match repository ownership.

- Read-only tools should never write files.
- Write tools should validate plans before applying changes.
- Tools should respect protected fixtures, generated files, vendor code, and workspace boundaries.
- Large responses should stream, page, summarize, or reference artifacts rather than returning unbounded payloads.
- Tool behavior should be current-state only, with no legacy compatibility shims.

## Testing Expectations

Add or update tests for:

- input schema validation
- stable output shape
- error payloads
- dry-run and write behavior
- large-result summarization
- permission or path rejection cases
- delegation to owning workspace APIs

## Checklist

Before finishing MCP work, verify:

1. The tool solves a real agent workflow.
2. Domain behavior is delegated to the owning workspace.
3. Input and output schemas are typed and stable.
4. Results are compact and deterministic.
5. Write behavior is explicit and validated.
6. Tests cover success and failure payloads.

## Prohibited Patterns

- MCP tools that duplicate CLI or workspace domain logic.
- Returning entire project indexes or source files when targeted context would do.
- Write behavior hidden behind read-sounding tool names.
- Legacy tool aliases or compatibility payloads.
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass typing.
