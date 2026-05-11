---
name: refactor-codemods
description: Use this skill when working on project-wide refactors, codemods, rename transactions, workspace edits, metadata updates, codemod safety, or refactor CLI behavior.
---

# Refactor Codemods Skill

## Purpose

Use this skill when an agent is changing project-wide codemods or refactor transactions.

The refactor target state is a deterministic, explicit, project-aware edit engine:

- plan safe multi-file changes
- update GML and GameMaker metadata together when required
- use semantic facts for correctness
- validate whole-plan conflicts before writing
- stream large workloads without unbounded memory
- expose automation-friendly codemods for building and maintaining GameMaker games

Refactor work should improve structure at the source rather than preserving transitional paths.

## Ownership

Refactor owns:

- codemod planning and execution
- cross-file edits
- rename and migration transactions
- GameMaker resource metadata updates
- project-aware impact analysis
- global edit validation
- workspace edit application
- refactor command behavior that is specific to codemods
- **Codemod/fixer commands are responsible for repairing non-parsable source text to restore parsability.**

Refactor does not own:

- formatter layout policy. **The formatter never repairs invalid syntax and only formats valid AST.**
- lint rule diagnostics except as a consumer-facing handoff. **Lint rule autofixes are responsible for fixing valid-but-forbidden syntax (e.g., style violations or deprecated patterns that are still syntactically valid).**
- parser syntax behavior
- semantic index construction internals
- transpiler output
- UI presentation

If a change is single-file and safely autofixable, it may belong in lint. If it is layout-only, it belongs in format.

## Working Approach

Before editing a codemod:

1. Define the exact migration and whether it is syntactic, semantic, metadata-aware, or all three.
2. Identify required semantic facts and project resource data.
3. Search for existing codemods, workspace edit helpers, and duplicate edit logic.
4. Design a plan, validation, and write phase separately.
5. Add tests for dry-run behavior, written edits, conflicts, and rollback-sensitive cases.

Implementation should:

- separate discovery, planning, validation, and application
- keep edit operations typed and deterministic
- write only after the whole plan is validated
- stream or chunk large projects instead of retaining all intermediate overlays
- use established parsers or structured APIs for metadata formats
- run codemod, lint write, formatter, build, and tests in the intended pipeline where relevant

## Safety Model

Refactors may be intentionally broad, but they must be controlled.

- Make destructive behavior explicit through command naming and write flags.
- Provide dry-run output that is useful to humans and automation agents.
- Detect overlapping edits before writing.
- Preserve line endings and encodings where the repository owns them.
- Avoid partial writes when validation fails.
- Treat generated output and protected golden fixtures according to repository rules.

## GameMaker Project Awareness

Project-aware codemods should understand GameMaker structure.

- Use `.yyp`, `.yy`, resource paths, scripts, objects, shaders, rooms, and events through typed domain models.
- Keep metadata edits synchronized with source edits.
- Respect strict GML semantics, including scope, globals, built-ins, and resource references.
- Prefer existing well-maintained libraries for structured file formats where they reduce risk.

## Testing Expectations

Add or update tests for:

- plan output
- write output
- cross-file rename safety
- metadata updates
- conflict detection
- no-op behavior
- large-project chunking when performance is part of the change

Do not modify protected `.gml` fixtures unless explicitly permitted.

## Checklist

Before finishing refactor work, verify:

1. The capability truly requires project-aware edits.
2. Planning, validation, and writing are separated.
3. The codemod is deterministic and typed.
4. Memory use is bounded for large project paths.
5. Tests cover success, no-op, and conflict cases.
6. The change does not duplicate lint or semantic ownership.

## Prohibited Patterns

- Compatibility wrappers for old codemod APIs or command formats.
- Single-file lint fixes implemented as refactor-only behavior without reason.
- Applying edits before whole-plan validation.
- String-editing structured metadata when a structured parser/model is available.
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass typing.
