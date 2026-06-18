---
name: game-debugging
description: Diagnose GameMaker gameplay, resource, build, and runtime failures from reproducible evidence. Use when the game behaves incorrectly, fails validation, or cannot build or run.
---

# Game Debugging

Start from evidence. Record the expected behavior, observed behavior, shortest reproduction, relevant room or resource, and whether the failure occurs during validation, build, startup, or play.

## Isolate The Failing Layer

1. Reproduce the issue without unrelated edits.
2. Run the narrow GMLoop inspection or validation command for the involved file or resource.
3. Identify whether ownership belongs to GML syntax, gameplay state, object lifecycle, resource relationships, room setup, runtime behavior, or the build provider.
4. Reduce the reproduction while preserving the failure.
5. Form one falsifiable hypothesis and test it before changing multiple systems.

Use structured diagnostics, stack traces, resource inspection, deterministic state capture, and targeted tests before broad debug logging. When logging is necessary, log the smallest state transition or boundary that distinguishes working from failing behavior.

## Common Checks

- Create state exists before Step, Draw, collision, alarm, or async code reads it.
- State transitions do not repeat one-time entry work.
- Collision consequences are not applied once per overlapping instance or frame unintentionally.
- Room layers, placed instances, parent relationships, and referenced resources exist.
- Persistent objects are not duplicated across room transitions.
- Random seeds, clocks, delta-time, and input are controlled in reproductions.
- Build diagnostics refer to the same runtime and target used by the failing run.

## Fix And Prove

Fix the owning source rather than suppressing its downstream symptom. Add or strengthen a regression test when the behavior is automatable. Remove temporary instrumentation, rerun the minimal reproduction, then run the relevant resource validation, test, build, and runtime smoke checks.

Report the root cause, evidence that confirmed it, changed resources or scripts, regression coverage, and any environment-dependent behavior not reproduced.
