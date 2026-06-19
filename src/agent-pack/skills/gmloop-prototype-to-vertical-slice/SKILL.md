---
name: gmloop-prototype-to-vertical-slice
description: Turn a GameMaker prototype into a coherent, playable vertical slice with bounded content, integrated systems, tests, and polish. Use when advancing from isolated mechanics to a complete representative experience.
---

# Prototype To Vertical Slice

Define the shortest complete player journey that demonstrates the intended game from launch through a meaningful outcome. Use the existing prototype as evidence: preserve mechanics that serve the core loop and remove or defer disconnected experiments.

## Slice Contract

The slice should include:

- A clear entry point and lightweight onboarding.
- The complete core loop with its primary player verbs.
- One representative environment, encounter, puzzle, or content path.
- Progress, success, failure, retry, and exit behavior.
- Coherent player feedback and minimum presentation pass (relying on `gmloop-game-design` for conceptual signals and `gmloop-game-polish-and-juice` for the polish pass).
- Deterministic tests for gameplay logic and runtime/build verification (relying on `gmloop-gml-tests` for standard test layer definitions).

Write acceptance criteria before expanding implementation. Every task should connect to a slice criterion or remove a blocker to proving one.

## Integration Order

1. Make the player journey completable with placeholder presentation.
2. Stabilize state ownership, resource relationships, and room flow.
3. Add tests for core rules and regressions.
4. Integrate readability feedback, onboarding, and representative content.
5. Validate build, launch, success, failure, retry, and cleanup.
6. Polish the highest-frequency and highest-consequence moments (using `gmloop-game-polish-and-juice`).

Defer content breadth, alternate modes, generalized frameworks, speculative extensibility, and progression that the representative journey does not exercise.

## Completion Review

Run the slice from a clean project state. Confirm no manual editor repair is required, all referenced resources resolve, the intended target builds and launches, and the player can reach success and failure through normal input.

Record known limitations separately from required acceptance criteria. Finish with the exact verification performed and the next highest-value task, not a broad backlog of optional features.
