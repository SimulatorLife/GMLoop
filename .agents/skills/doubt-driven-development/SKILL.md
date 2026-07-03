---
name: doubt-driven-development
description: Apply adversarial verification during any meaningful code change before the approach hardens. Use for medium or larger changes where regressions, hidden coupling, ownership mistakes, or invalid assumptions are plausible. Skip only trivial mechanical edits.
---

# Doubt-Driven Development

## Overview

Doubt-Driven Development is a coding workflow for meaningful changes where the first reasonable solution may still be wrong.

Challenge ownership, assumptions, abstractions, edge cases, and test coverage before the implementation hardens.

Make the smallest correct change, prove the real behavior, and avoid unnecessary complexity.

## When to Use

Use for meaningful code changes where the first correct-looking solution may hide risk:

- Medium or larger implementation changes
- Refactors that move behavior, ownership, or responsibility
- Changes that affect shared helpers, public APIs, fixtures, generated output, or many call sites
- Bug fixes where the root cause is uncertain
- Changes that add new state, configuration, abstractions, or systems
- Changes where existing tests may pass without proving the intended behavior

Skip for trivial mechanical edits, such as renames, comment changes, formatting-only movement, or obvious one-line fixes.

## Core Loop

1. **Frame the Change**: identify the bug, feature, refactor, or design pressure being addressed. State the smallest useful outcome.
2. **Find the Existing Owner**: check whether an existing system, helper, workspace, or pattern should handle this before adding anything new.
3. **State the Risky Assumption**: name the assumption most likely to be wrong, such as ownership, abstraction level, edge-case behavior, or test coverage.
4. **Try to Disprove the Approach**: look for counterexamples, boundary violations, hidden coupling, duplicated paths, and cases where existing tests would pass but behavior would still be wrong.
5. **Make the Smallest Correct Change**: implement only what survives the adversarial check. Prefer improving an existing path over creating a parallel one.
6. **Prove the Behavior**: add or update focused tests for the real invariant, then run targeted validation.
7. **Check System Fit**: verify that the final change did not add unnecessary state, configuration, ownership confusion, or cross-workspace compensation.
8. **Run Full Validation**: run required build(s), linting, and test commands before considering the change complete.

## Before Implementing

Run a design pass before writing code:

- What existing system should own this?
- What invariant should become simpler after the change?
- What behavior should not change?
- What tests or fixtures would prove the approach is safe?
- What would make this design obviously wrong?

## After Implementing

After code exists, challenge the actual artifact, not the intention.

Check:

- Did the implementation match the claim?
- Did it introduce a second path for the same behavior?
- Did tests prove the important edge case or only the happy path?
- Did validation pass for the relevant workspace and the whole project?
- Is the final code simpler, or only more capable?

## Non-Goals

This skill does not authorize broad rewrites, opportunistic cleanup, or speculative architecture changes.

Use doubt to make the current change safer. Do not use it to justify replacing working systems unless the existing system clearly violates the contract.

## GMLoop-Specific Checks

For each non-trivial decision, challenge:

- Is parser still GML -> AST only?
- Did core remain parser/formatter agnostic?
- Did plugin avoid semantic rewrites owned by lint/refactor systems?
- Any illegal imports, dynamic imports, or boundary-skipping deep paths?
- Any accidental golden `*.gml` fixture edits?
- Are tests covering edge cases introduced by the change?

## Evidence Requirements

Doubt is incomplete without executable evidence.

Run:

```bash
pnpm run build:ts
pnpm run lint:quiet
pnpm run test
```

Use targeted tests while iterating, then run full validation before completion.

## Evidence may include:

- A focused regression test
- A before/after fixture comparison
- A failing command that now passes
- A code path walkthrough tied to the contract
- A type/lint/build check
- A documented trade-off with a reason it is acceptable

Do not count intuition, reviewer agreement, or passing unrelated tests as evidence.

## Red Flags

- Treating confidence as proof
- Accepting reviewer feedback / assumptions without checking artifacts or code
- Repeating cycles without changing artifact/contract
- Skipping adding tests for behavior-affecting edits
- Making tests "Pass" by weakening assertions instead of fixing source logic

## Assume the first solution may be wrong because it:

* Places behavior in the most convenient workspace instead of the correct owner
* Fixes the observed failure but not the underlying invariant
* Builds a new system when an existing system should be extended, simplified, or made more capable
* Adds coupling that future features will depend on accidentally
* Passes existing tests while leaving the real edge case uncovered
* Treats formatting, linting, parsing, and refactoring responsibilities as interchangeable
* Overcomplicates a simple problem instead of simplifying the underlying constraint
* Assumes the current failure is the whole problem
* Adds a special case where a general rule is missing
* Solves the problem at the wrong abstraction level
* Introduces state where a derived value would be safer
* Adds configuration where convention would be clearer
* Makes the implementation more flexible than the contract requires
* Relies on ordering, timing, or side effects that are not part of the contract
* Assumes existing tests cover the behavior they appear to cover
* Fixes one workspace by making another workspace compensate for it
* Adds a new helper instead of making the existing helper correct
* Creates a parallel path that future changes must keep in sync
* Makes the change pass validation without explaining why the behavior is correct
* Prioritizes convenience at the cost of project clarity
* Makes the easy path correct while leaving edge cases undefined
* Preserves an old boundary that should be simplified
* Moves behavior without proving the new owner is better
* Couples behavior to a fixture, filename, or test shape instead of the real invariant

## Completion Criteria

- Non-trivial claims were explicit
- At least one adversarial pass challenged each non-trivial artifact
- Findings were resolved, accepted as explicit trade-offs, or disproven with evidence
- Build, lint, and relevant tests validate the final state