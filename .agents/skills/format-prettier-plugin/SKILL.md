---
name: format-prettier-plugin
description: Use this skill when working on the GML formatter or Prettier plugin, including printing, layout, comment placement, formatting options, formatter tests, or formatter/linter ownership boundaries.
---

# Format Prettier Plugin Skill

## Purpose

Use this skill when an agent is changing the formatter workspace or Prettier plugin behavior.

The formatter target state is deterministic, opinionated, and layout-focused:

- parse valid GML
- produce stable formatted GML
- own whitespace, indentation, wrapping, spacing, comment layout, and safe lexical canonicalization
- avoid semantic rewrites, content mutation, project-aware changes, and syntax repair

The formatter should feel boringly predictable to users and boringly constrained to maintainers.

## Ownership

The formatter owns:

- AST-to-GML printing
- indentation and grouping
- print-width wrapping
- blank-line and spacing layout
- semicolon and delimiter rendering
- comment placement and formatting when text content is unchanged
- formatter-owned lexical canonicalization explicitly allowed by the target state

The formatter does not own:

- lint diagnostics
- doc-comment promotion or tag synthesis
- semantic interpretation
- cross-file edits
- project metadata updates
- AST transformations that change program meaning
- syntax recovery or repair for invalid GML

If the behavior changes source content based on meaning, move it to lint or refactor.

## Working Approach

Before editing formatter behavior:

1. Identify whether the change is layout-only.
2. Check the target-state formatter/linter boundary.
3. Search for existing print, comment, normalize, and fixture behavior.
4. Add or update tests that capture the exact formatting contract.

Implementation should:

- use Prettier document builders instead of string concatenation where possible
- keep printer logic deterministic and side-effect free
- keep parsing strict and fail without mutating invalid input
- preserve comments without interpreting their semantic meaning
- use a single opinionated strategy rather than adding broad options
- keep Prettier dependencies confined to the formatter/plugin ownership boundary

## Boundary Rules

Formatter-owned examples:

- indentation
- spaces around operators
- wrapping long expressions
- final newline insertion
- stable parenthesis rendering when syntactically safe
- numeric zero normalization explicitly allowed by target state
- logical operator style rendering when configured by the project contract

Lint-owned or refactor-owned examples:

- promoting `// description` to documentation comments
- synthesizing `@param` tags
- removing placeholder comments because they are semantically empty
- rewriting deprecated APIs
- changing `globalvar` declarations to `global.` assignments
- updating `.yy` or `.yyp` metadata

When in doubt, prefer not to put content-aware behavior in the formatter.

## Comment Handling

Comments are high-risk because layout and content are easy to blur.

- The formatter may move, attach, indent, wrap, or preserve comments when the comment text stays the same.
- The formatter must not infer documentation structure from ordinary comments.
- The formatter must not upgrade comment kinds or synthesize tags.
- Shared comment parsing helpers can live in core only when they are policy-free.
- Content normalization belongs in lint rules with diagnostics and tests.

## Tests And Fixtures

Add tests for:

- idempotence
- comments before, after, and inside constructs
- nested expressions and ambiguous parentheses
- malformed input behavior when relevant
- print-width-sensitive wrapping
- edge cases from real GameMaker syntax

Do not modify protected `.gml` golden fixtures unless explicitly permitted by the user. Prefer adding `.test.ts` coverage or new approved fixtures where allowed.

## Quality Bar

Formatter changes should:

- preserve program behavior
- avoid unnecessary configuration
- keep output stable across repeated runs
- avoid depending on object iteration order where determinism matters
- reuse established Prettier APIs and repository helpers
- keep performance proportional to source size where practical

## Checklist

Before finishing formatter work, verify:

1. The change is layout or explicitly allowed lexical canonicalization.
2. Invalid GML is not silently repaired by the formatter.
3. Comment text is not semantically interpreted or rewritten.
4. Tests cover the exact formatting shape and idempotence risk.
5. No lint, semantic, refactor, or project-aware behavior entered the formatter.
6. Public API and workspace dependency rules remain intact.

## Prohibited Patterns

- Semantic or content rewrites in printer code.
- Fallback printers for malformed syntax.
- Broad formatter options that allow multiple contradictory house styles.
- Embedded source templates as large string literals.
- Dynamic imports, `require()`, `any`, or non-null assertions to bypass type issues.
