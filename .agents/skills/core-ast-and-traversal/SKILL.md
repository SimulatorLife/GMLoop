---
name: core-ast-and-traversal
description: Use this skill when working on shared core AST types, node metadata, traversal, structural helpers, cloning, equality, path utilities, or public core API boundaries.
---

# Core AST And Traversal Skill

## Purpose

Use this skill when an agent is changing shared AST infrastructure or reusable structural utilities.

The core target state is a pure, typed data-model workspace that downstream tools can trust:

- stable AST types and node-kind contracts
- traversal and visitor helpers
- structural clone and equality helpers
- path and metadata utilities
- shared comment and node helpers with no parser, formatter, lint, refactor, or transpiler policy

This skill is not a generic utility guide. Core should only contain shared abstractions that express domain concepts used by multiple workspaces.

## Ownership

Core owns:

- AST interfaces and node-kind definitions
- structural helpers for nodes, ranges, comments, and metadata
- traversal, walking, visitor, and path utilities
- clone and equality behavior
- small shared primitives needed across workspace boundaries

Core does not own:

- parsing logic
- printing or formatting rules
- lint diagnostics or autofixes
- semantic symbol resolution
- project-aware indexing
- codemod planning
- JavaScript emission
- CLI command behavior

If a helper needs formatter policy, lint interpretation, semantic analysis, or project context, keep it out of core and place it in the owning workspace.

## Working Approach

Before adding core functionality:

1. Search for existing domain helpers and duplicate behavior.
2. Confirm at least two real consumers need the abstraction or that it is part of the public AST contract.
3. Model the exact domain concept with precise types instead of broad generic utilities.
4. Add mirrored tests under the core test tree.

Implementation should:

- prefer small cohesive modules by domain
- keep source files under the repository size guidelines
- expose public core functionality through explicit namespace exports
- avoid pass-through wrappers and re-export-only indirection outside approved `index.ts` surfaces
- use static TypeScript imports with NodeNext `.js` specifiers
- keep APIs immutable or clearly mutation-oriented by name and type

## Type Design

Core types should make invalid states hard to represent.

- Use discriminated unions for AST node families.
- Prefer required fields when the data is logically required.
- Use optional properties only for genuinely optional language or analysis data.
- Define narrower input types instead of accepting broad `Partial<T>`.
- Avoid `any`; use precise unions or `unknown` with safe refinement only when the input is genuinely unknown.
- Avoid non-null assertions by correcting ownership and initialization.
- Name helpers after the domain operation they perform.

## Traversal Rules

Traversal helpers should be predictable and reusable.

- Preserve deterministic visit order.
- Make mutation behavior explicit.
- Avoid hidden parsing, formatting, or semantic behavior inside traversal callbacks.
- Keep visitor contracts typed by node kind where practical.
- Prefer reusable traversal APIs over one-off recursive implementations when they reduce real duplication.
- Do not introduce traversal abstractions so generic that they obscure AST ownership.

## Public API Rules

- The workspace root should expose core through the repository's namespace-export convention.
- Public functions and types need TSDoc when newly exported.
- Public exports should describe core concepts, not downstream workspace conveniences.
- Internal core modules should import each other directly by relative path, not through the public namespace.
- External workspaces should consume core through the core public namespace.

## Testing Expectations

Add or update tests when core behavior changes.

- Test traversal order, skipped nodes, replacements, mutation behavior, and edge cases.
- Test clone and equality helpers for nested nodes and metadata preservation.
- Test path utilities with representative AST shapes.
- Include regression tests for bugs caused by shared helper behavior.

## Checklist

Before finishing core work, verify:

1. The change belongs in shared core rather than a downstream workspace.
2. The type model expresses the required domain state without broad optionality.
3. Public exports have TSDoc and tests.
4. No parser, formatter, lint, semantic, refactor, transpiler, CLI, UI, or MCP policy leaked into core.
5. Existing consumers import through approved boundaries.
6. Duplicate helper behavior was removed or avoided.

## Prohibited Patterns

- Catch-all helper, common, misc, or utils modules.
- Pass-through files that import another workspace solely to re-export it.
- Core functions that parse, print, lint, refactor, transpile, or inspect project files.
- Dynamic imports or `require()` in TypeScript.
- Type assertions used to bypass incomplete AST modeling.
