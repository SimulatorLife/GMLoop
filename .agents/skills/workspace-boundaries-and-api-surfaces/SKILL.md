---
name: workspace-boundaries-and-api-surfaces
description: Use this skill when changing workspace public APIs, package boundaries, index exports, inter-workspace imports, dependency ownership, module structure, or architectural responsibility splits.
---

# Workspace Boundaries And API Surfaces Skill

## Purpose

Use this skill when an agent is changing module boundaries, public exports, package dependencies, or ownership between workspaces.

The target state is a TypeScript monorepo with clean domain ownership:

- each workspace has one cohesive responsibility
- public APIs are explicit and namespace-based
- internal code uses direct relative imports
- external consumers import workspace namespaces
- generated and vendor outputs remain disposable or read-only
- obsolete transitional layers are removed instead of preserved

This skill is cross-cutting and should be used when the task affects more than one workspace or an exported contract.

## Ownership Model

Respect the target responsibility split:

- Parser: GML syntax to AST.
- Core: AST data model and shared structural helpers.
- Format: layout-only Prettier plugin behavior.
- Lint: single-file diagnostics and safe local fixes.
- Semantic: symbol, scope, graph, and project index facts.
- Refactor: project-aware codemod transactions and metadata edits.
- Transpiler: GML AST and semantic facts to JavaScript patches.
- Runtime wrapper: browser-side hot patching and dispatch.
- CLI: user-facing command orchestration.
- MCP: agent-facing tool orchestration.
- UI: light-DOM Lit application surfaces.

When ownership is unclear, choose the workspace that owns the underlying domain behavior, not the most convenient call site.

## Import And Export Rules

Follow the repository's module strategy.

- TypeScript source uses `.js` specifiers for relative imports.
- Imports are static and top-level.
- Cross-workspace imports use package names.
- External workspace consumers import the single public namespace.
- Internal code inside a workspace uses direct relative imports, not its own public namespace.
- `index.ts` files are export surfaces only and contain no runtime logic.
- Do not deep-import another workspace's internals.
- Do not import from `dist` in source.

## Public API Design

Public APIs should be small, typed, and owned.

- Export only concepts the workspace owns.
- Add TSDoc for new public functions and types.
- Add tests that mirror new public behavior.
- Avoid pass-through wrappers that re-export another workspace's API.
- Remove obsolete API paths and migrate call sites directly.
- Do not add compatibility shims for old imports, command formats, or payloads.

## Dependency Discipline

Dependencies should support the domain without creating architectural drift.

- Reuse existing established dependencies where they are appropriate.
- Prefer well-maintained libraries for parsing structured formats, protocols, graph algorithms, or storage when they reduce risk.
- Keep formatting dependencies confined to the formatter/plugin ownership boundary.
- Do not add dependencies to avoid understanding existing workspace APIs.
- Avoid duplicate libraries that solve the same problem unless there is a documented reason.

## Refactoring Approach

When boundary issues appear:

1. Identify the real owner of the behavior.
2. Move implementation to the owner rather than adding a wrapper.
3. Update callers to depend on the owner through its public API.
4. Delete obsolete transitional layers.
5. Add tests at the owning workspace and integration coverage if cross-workspace behavior changed.

## Checklist

Before finishing boundary work, verify:

1. Each changed symbol lives in the workspace that owns it.
2. Public exports expose one cohesive namespace per workspace.
3. `index.ts` files contain only exports.
4. No source imports from `dist` or another workspace's internals.
5. No pass-through wrappers or compatibility shims were added.
6. Tests and docs reflect the new ownership.

## Prohibited Patterns

- Catch-all utility modules.
- Deep imports across workspace boundaries.
- Re-export wrappers for another workspace's API.
- Optionality, `any`, or non-null assertions used to paper over incomplete design.
- Dynamic imports, `require()`, `.ts` import specifiers, or source `.js` files outside permitted generated/vendor areas.
