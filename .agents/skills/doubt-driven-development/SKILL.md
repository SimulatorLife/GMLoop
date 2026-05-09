---
name: doubt-driven-development
description: Apply adversarial verification to non-trivial decisions before they stand. Use when correctness matters more than speed, especially for parser/core/plugin boundary changes, AST invariants, formatting correctness, and irreversible repo operations.
---

# Doubt-Driven Development

## Overview

Use structured skepticism for non-trivial decisions. The goal is to disprove your own approach early, while fixes are still cheap.

This is an in-flight method, not only final review.

## When to Use

Use for decisions that:

- Change control flow or invariants
- Cross workspace boundaries (`core`/`parser`/`plugin`)
- Affect AST shape, node typing, or traversal semantics
- Alter formatter behavior in ways that may shift output broadly
- Could create hard-to-revert regressions

Skip for trivial mechanical edits (rename, formatting-only movement, obvious one-line fixes).

## Core Loop

1. **Claim**: write the decision and why it matters.
2. **Extract**: isolate artifact + contract.
3. **Adversarial Review**: seek breakage, not validation.
4. **Reconcile**: classify findings and update code/tests.
5. **Stop**: finish when findings are resolved or no longer substantive.

### Claim Template

```text
CLAIM: <what should be true>
WHY IT MATTERS: <failure impact>
```

### Artifact + Contract Template

```text
ARTIFACT:
- minimal diff/function/design decision

CONTRACT:
- required behavior
- invariants that must remain true
- boundary constraints (workspace ownership, import rules, fixture rules)
```

### Adversarial Prompt Template (tool-agnostic)

```text
Find what is wrong with this artifact against the contract.
Prioritize: incorrect assumptions, edge cases, boundary violations,
regressions, hidden coupling, and test gaps.
Do not summarize positives. Report concrete failure risks.
```

Pass only `ARTIFACT + CONTRACT` to the reviewer. Do not pass your conclusion.

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

## Red Flags

- Treating confidence as proof
- Accepting reviewer feedback without checking artifact text
- Repeating cycles without changing artifact/contract
- Skipping tests for behavior-affecting edits
- “Passing” by weakening assertions instead of fixing source logic

## Completion Criteria

- Non-trivial claims were explicit
- At least one adversarial pass challenged each non-trivial artifact
- Findings were resolved, accepted as explicit trade-offs, or disproven with evidence
- Build, lint, and relevant tests validate the final state
