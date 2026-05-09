---
name: code-simplification
description: Simplifies code for clarity while preserving behavior. Use when code works but is harder to read, maintain, or extend than it should be, especially in this TypeScript + GML monorepo.
---

# Code Simplification

## Overview

Simplify implementations without changing behavior. In this repository, simplification should also reinforce architectural boundaries:

- `@gml-modules/core`: AST model + structural/traversal helpers
- `@gml-modules/parser`: GML -> AST only
- `@gml-modules/plugin`: formatter-only AST transforms + printing + Prettier glue

A simplification that blurs these boundaries is not a simplification.

## When to Use

- A change is correct but difficult to understand quickly
- A function does too many jobs (parse + normalize + print in one place, etc.)
- Similar logic appears in multiple workspaces/files
- Naming is vague (`handle`, `process`, `data`, `tmp`)
- Control flow is deeply nested or brittle around edge cases

## When Not to Use

- You do not yet understand behavior and invariants
- It is a pure mechanical update already handled by tooling
- You are mixing feature work and broad refactors in one diff

## Repository-Specific Constraints

- Keep source edits in `.ts`; do not edit `dist/**` or `src/parser/generated/**`
- Do not modify golden `*.gml` fixtures unless explicitly asked
- Keep imports static and top-level (no dynamic `import()` / `require()`)
- Prefer domain files over generic `utils.ts`/`helpers.ts`
- Preserve workspace API boundaries and namespace import style

## Process

1. Understand current behavior first.
2. Identify one simplification unit (single function, branch, or small module).
3. Apply the smallest coherent refactor.
4. Validate immediately.
5. Repeat.

Validation commands for this repo:

```bash
pnpm run build:ts
pnpm run lint:quiet
pnpm run test
```

If full tests are slow, run targeted workspace tests during iteration, then run the full suite before finishing.

## High-Value Simplification Targets in GMLoop

- Replace nested parser/plugin branching with explicit guard clauses
- Extract repeated AST predicates into well-named core helpers
- Split formatter logic so layout decisions are isolated from node traversal
- Remove pass-through wrappers/re-export shims and import from the correct public workspace API
- Replace optionality used as a shortcut with precise required types

## Language-Specific Examples

### TypeScript (preferred source language)

```ts
// Before: dense branching + vague naming
function process(n: Core.AST.Node, s: State) {
  if (n.type === "IfStatement") {
    if (n.elseBranch) {
      return doThing(n, s);
    }
  }
  return fallback(n, s);
}

// After: explicit intent + guard clause
function formatConditionalNode(node: Core.AST.Node, state: State) {
  if (node.type !== "IfStatement" || !node.elseBranch) {
    return fallback(node, state);
  }
  return formatIfWithElse(node, state);
}
```

### GML fixture-facing logic (do not edit golden fixtures)

```ts
// Prefer changing transformation logic/tests, not fixture text.
// Example: simplify normalize pass rather than rewriting fixture content.
```

## Definition of Done

- Behavior preserved (same outputs, errors, side-effects)
- `pnpm run build:ts` passes
- `pnpm run lint:quiet` passes
- Relevant tests added/updated and passing
- Diff stays scoped and easier to review than before
