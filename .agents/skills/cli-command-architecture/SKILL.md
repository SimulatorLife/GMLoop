---
name: cli-command-architecture
description: Use this skill when working on CLI commands, command routing, watch mode, project path handling, telemetry, command tests, or exposing repository tooling through the CLI.
---

# CLI Command Architecture Skill

## Purpose

Use this skill when an agent is changing command-line behavior.

The CLI target state is the discoverable automation surface for GMLoop:

- expose formatting, linting, refactors, graph, semantic, transpiler, and hot-reload workflows
- coordinate workspace capabilities without owning their internal logic
- provide predictable machine-readable output where automation agents need it
- handle GameMaker project paths, files, and `.yyp` inputs consistently
- avoid standalone ad hoc scripts outside the command architecture

The CLI should be thin where possible, but not careless. It owns user workflow coordination and command contracts.

## Ownership

CLI owns:

- command registration and parsing
- user-facing options and help text
- path resolution for files, folders, and GameMaker projects
- command orchestration across workspaces
- watch-mode coordination
- process exit codes
- telemetry and reporting contracts
- machine-readable output modes

CLI does not own:

- parser grammar
- formatter printing logic
- lint rule behavior
- semantic index internals
- codemod edit planning
- transpiler emission
- runtime wrapper internals

If a command starts accumulating domain logic, move that logic into the owning workspace and keep the CLI as a coordinator.

## Working Approach

Before editing a command:

1. Identify the owning workspace for the core behavior.
2. Search for existing command patterns and shared command helpers.
3. Define inputs, outputs, exit codes, and write behavior.
4. Consider both human terminal use and AI-agent automation use.
5. Add tests for command parsing, orchestration, and output contracts.

Implementation should:

- expose new tooling through `src/cli/src/commands`
- avoid standalone Node scripts for durable workflows
- keep options narrow and purpose-driven
- avoid legacy command aliases or compatibility flags
- use structured output when a command is intended for automation
- keep errors actionable with paths and next steps

## Path And Project Handling

CLI path behavior should be strict and consistent.

- Accept a `.gml` file, project directory, or `.yyp` path only where the command supports that scope.
- Resolve paths once and pass typed inputs to owning workspaces.
- Do not autodetect unsupported custom file extensions.
- Keep GameMaker project structure handling in typed models rather than scattered string checks.
- Preserve workspace boundaries when commands coordinate multiple packages.

## Automation Contracts

AI agents should be able to call CLI workflows reliably.

- Prefer deterministic output ordering.
- Provide quiet and structured output modes where useful.
- Include source locations, rule IDs, symbol IDs, and edit summaries in machine-readable payloads.
- Use clear non-zero exit codes for failure states.
- Avoid interactive prompts for workflows that must run in automation.

## Watch Mode

Watch-mode behavior should be bounded and robust.

- Debounce file events intentionally.
- Rebuild only the affected scope when semantic impact allows.
- Keep stale diagnostics, patches, and graph data from leaking into later cycles.
- Surface runtime and transpiler errors without crashing long-running sessions when recoverable.
- Clean up servers, sockets, file watchers, timers, and temp files.

## Testing Expectations

Add or update tests for:

- command argument parsing
- path resolution
- dry-run and write modes
- exit codes
- structured output
- watch orchestration where feasible
- regression cases from real GameMaker project layouts

## Checklist

Before finishing CLI work, verify:

1. Domain logic lives in the owning workspace.
2. Command options are current and necessary.
3. Output is deterministic enough for automation.
4. Exit codes and errors are intentional.
5. Tests cover command behavior and important failure cases.
6. No legacy wrappers or duplicate command paths were added.

## Prohibited Patterns

- Durable standalone scripts outside the CLI command tree.
- Legacy aliases or compatibility command formats.
- CLI code that duplicates parser, lint, format, semantic, refactor, or transpiler logic.
- Interactive-only behavior for automation workflows.
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass typing.
