---
name: gmloop-tooling
description: Use GMLoop's MCP and CLI capabilities to inspect, parse, recover, refactor, lint, format, validate, and understand a GameMaker project. Use when changing GML code, configuring gmloop.json, choosing a GMLoop workflow, or investigating project symbols and relationships.
---

# GMLoop Tooling

GMLoop is a GameMaker development toolchain for GML parsing, formatting, linting, safe refactors, semantic project analysis, validation, tests, runtime workflows, and automation. Its MCP surface is generated from the current CLI command catalog, so discover capabilities at runtime instead of memorizing tool names or argument schemas.

## Discover The Current Surface

1. Resolve the project root from the active `.yyp` file.
2. Inspect the connected MCP server's current tools and resources before choosing an operation.
3. Use each discovered tool's description and input schema as the authoritative contract.
4. For CLI usage details, use the stable help entrypoint: `gmloop help <command>`.
5. If a capability is absent, do not invent a tool name, option, or payload. Use another discovered capability or report the missing operation.

Expect capability groups for source parsing and validation, formatting, lint diagnostics and fixes, refactors and codemods, semantic graph inspection, project/resource inspection, tests, replay, runtime, and reporting. The exact commands and MCP tools may evolve without changing this workflow.

## Understand `gmloop.json`

Treat `gmloop.json` as the project-root configuration shared by GMLoop workspaces. It is an open JSON object whose sections are validated by their owning capabilities.

- Formatter-owned options live at the top level.
- `lintRuleset` selects a baseline and `lintRules` contains project rule-level overrides.
- `refactor.codemods` selects and configures project codemods.
- `runtime` contains runner, build, live-reload, and related execution configuration when those workflows are used.
- `autoGame` contains Auto-Game preferences such as excluded project skills.

Inspect the current configuration catalog or relevant help before adding keys. Preserve unrelated sections, use the UI/configuration capability when available, and do not copy a stale exhaustive example over project-owned settings.

## Apply A Source Change

Use this order for each bounded change:

1. **Inspect:** Read the owning files, related symbols, references, resources, and configured rules. Use semantic graph context when the change crosses files or ownership is unclear.
2. **Edit:** Make the smallest coherent change at the owning source. Use structured resource tooling for GameMaker metadata.
3. **Parse:** Run strict parsing on every changed GML file before transformations.
4. **Recover syntax:** If strict parsing fails, inspect the diagnostic and use the currently available syntax-recovery or recovery-capable codemod workflow in dry-run mode. Apply only relevant edits, then parse again. Fix the source directly when recovery cannot prove a safe repair.
5. **Refactor:** Use the semantic rename transaction for symbol renames. Run applicable configured codemods against the narrowest target and review the planned edits before write mode.
6. **Lint:** Run relevant lint diagnostics and safe fixes. Review remaining diagnostics instead of suppressing them or weakening project rules.
7. **Format:** Format only parseable GML after semantic and lint changes have settled.
8. **Revalidate:** Parse the final files again, inspect the diff, and run the narrow tests and project validation needed for the change.

Do not use formatting as syntax recovery. Do not perform project-wide text replacement for symbol renames. Do not run broad write operations before inspecting their target and planned scope.

## Continue Into Game Validation

After GMLoop source checks pass, continue with the project's autonomous development lifecycle for GameMaker compilation, unit tests, HTML5 execution, and gameplay/browser verification. Keep source-quality evidence distinct from engine build and runtime evidence; a successful parse does not prove that the game compiles or behaves correctly.

## Report

Record the project root, discovered capability used for each stage, changed files or resources, parse/recovery/refactor/lint/format results, tests run, and anything not validated. Report exact diagnostics and residual risk without claiming unavailable runtime evidence.
