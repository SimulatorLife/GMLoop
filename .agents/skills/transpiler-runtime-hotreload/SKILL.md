---
name: transpiler-runtime-hotreload
description: Use this skill when working on GML-to-JavaScript transpilation, runtime wrapper injection, hot reload patches, symbol dispatch, browser runtime integration, or live GameMaker execution behavior.
---

# Transpiler Runtime Hotreload Skill

## Purpose

Use this skill when an agent is changing transpilation or hot-reload runtime behavior.

The target state is a reliable live GameMaker development loop:

- parse and semantically classify changed GML
- transpile GML into correct JavaScript patches
- inject patches into the running runtime without restarting the game
- preserve GameMaker semantics for scope, dispatch, built-ins, assets, and shaders
- expose predictable automation hooks for AI agents building and modifying GameMaker games

This skill covers both the transpiler and runtime wrapper because their contracts must fit together, even though each workspace should keep its own ownership clean.

## Ownership

The transpiler owns:

- GML AST to JavaScript emission
- patch object generation
- semantic classification consumption
- dependency impact needed for recompilation
- source maps or provenance when required for debugging

The runtime wrapper owns:

- browser-side patch loading
- hot function and script registry behavior
- dispatcher overrides
- runtime bridge APIs
- safe application and rollback behavior for injected changes

They do not own:

- parser grammar
- formatter layout
- lint diagnostics
- codemod source edits
- CLI command parsing beyond consumed contracts
- UI presentation

## Working Approach

Before editing:

1. Identify the GameMaker semantic behavior that must be preserved.
2. Determine whether the change belongs in transpilation, runtime patching, CLI coordination, or semantic analysis.
3. Search for existing emit, shim, registry, and patch behavior.
4. Add tests for emitted JavaScript shape, runtime contract, and affected GameMaker edge cases.

Implementation should:

- consume semantic facts instead of reimplementing symbol resolution
- keep emitted JavaScript deterministic
- use established JavaScript tooling or runtime libraries where appropriate
- avoid broad compatibility layers for old patch formats
- keep runtime code small, explicit, and observable enough to debug
- preserve source provenance for errors where practical

## GameMaker Semantics

Transpilation must honor GameMaker behavior, not JavaScript resemblance.

- Resolve locals, `self`, `other`, `global`, built-ins, and script calls according to semantic analysis.
- Preserve evaluation order and short-circuit behavior.
- Model GameMaker-specific truthiness, arrays, structs, method calls, and event context correctly.
- Treat assets, shaders, scripts, objects, rooms, and resources as GameMaker concepts.
- Prefer explicit shims for semantic differences rather than relying on accidental JavaScript compatibility.

## Hot Reload Contract

Hot reload should be predictable and resilient.

- Patch application should be atomic from the runtime's perspective.
- The runtime should reject incompatible or incomplete patches with clear errors.
- Dependency impact should be narrow enough to avoid full reloads when possible.
- Registry updates should not leak old functions or stale closures.
- Runtime bridge messages should be typed and versioned by current contract, not legacy compatibility.
- Failed patches should leave the running game in a known state.

## Automation Use

The transpiler and runtime should support AI agents that modify GameMaker games.

- Provide machine-readable errors with source locations.
- Keep patch and diagnostics payloads compact and deterministic.
- Expose enough context to let agents identify the exact source change needed.
- Avoid hidden state that makes repeated automation runs diverge.

## Testing Expectations

Add or update tests for:

- emitted JavaScript for language constructs
- semantic identifier classifications in emission
- patch object shape
- runtime registry updates
- failed patch behavior
- dependency-based hot reload scope
- browser/runtime integration where feasible

Use unit tests first, then integration tests for end-to-end patch behavior.

## Checklist

Before finishing transpiler or runtime work, verify:

1. GameMaker semantics are preserved explicitly.
2. Symbol classification comes from semantic analysis when needed.
3. Patch contracts are typed and deterministic.
4. Runtime failure paths are known and tested.
5. No parser, lint, formatter, or refactor behavior leaked into this layer.
6. Tests cover both emitted shape and runtime behavior where the change crosses the boundary.

## Prohibited Patterns

- Reimplementing semantic resolution inside emitters.
- Relying on accidental JavaScript behavior for GameMaker semantics.
- Legacy patch compatibility wrappers.
- Runtime global state that cannot be reset or validated in tests.
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass typing.
