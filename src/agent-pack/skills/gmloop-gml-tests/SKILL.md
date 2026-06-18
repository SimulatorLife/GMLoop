---
name: gmloop-gml-tests
description: Design deterministic tests for GML gameplay, scripts, resources, and runtime behavior. Use when adding features, fixing regressions, or validating an Auto-Game build.
---

# GML Tests

Choose the lowest test level that can prove the behavior without depending on unrelated engine state.

## Test Layers

- Pure unit tests: calculations, data transforms, state transitions, cooldowns, scoring, economy, and deterministic selection.
- Resource integration tests: scripts, object events, room instances, parent relationships, and project metadata.
- Runtime smoke tests: engine lifecycle, collisions, room transitions, drawing, input integration, save/load, and asynchronous behavior.
- Build checks: syntax, resource references, target compilation, and launchability.

Do not replace a fast unit test with a runtime test when engine behavior is irrelevant. Do not claim runtime behavior is verified from parsing or static validation alone.

## Determinism

Control random seeds, clocks, input sequences, initial state, and fixture data. Keep tests independent of execution order and prior runs. Clean up created instances, files, rooms, and persistent state.

Test observable behavior rather than private implementation details or incidental log wording. Assert stable identifiers, state, outputs, resource relationships, and structured diagnostics.

## Coverage For Changes

For a feature, cover the primary success path and the most important boundary or failure path. For a regression, first add a test that fails for the reported behavior, then fix the source and keep the test.

Relevant cases commonly include:

- Empty, minimum, maximum, and transition-boundary values.
- Repeated input or collision events.
- Pause, restart, room change, and persistent-state cleanup.
- Missing or invalid resource relationships.
- Win and loss reached through actual gameplay state.

## Report

Run the narrow tests during development, then the relevant project validation and build checks. Report exact commands, pass/fail counts, fixture or runtime used, and behavior that remains manually verified. Never hide a failure by weakening an assertion or changing a golden fixture unrelated to the requested behavior.
