---
name: lint-rules-gml
description: Use this skill when working on GML ESLint language support, lint rules, diagnostics, single-file autofixes, rule tests, parser services, or formatter/lint/refactor boundaries.
---

# Lint Rules GML Skill

## Purpose

Use this skill when an agent is changing the lint workspace, ESLint language wiring, or GML lint rules.

The lint target state is a precise, single-file analysis and autofix layer:

- report actionable diagnostics
- provide safe local fixes
- own semantic and content rewrites that do not require project-wide knowledge
- expose a complete ESLint v9 language and recommended flat config
- keep project-aware edits in refactor
- keep layout-only behavior in format

Lint should help agents and developers improve GameMaker code without hiding risk or crossing workspace boundaries.

## Ownership

Lint owns:

- ESLint v9 language integration for GML
- rule metadata, messages, diagnostics, and docs surfaced through rule catalogs
- local single-file autofixes. **Lint rule autofixes are responsible for fixing valid-but-forbidden syntax (e.g., style violations or deprecated patterns that are still syntactically valid).**
- safe token-based fixes that can run before full AST success when explicitly designed
- content-aware single-file rewrites such as doc-comment normalization
- parser services that expose GML-specific metadata to rules

Lint does not own:

- cross-file edits
- project graph mutation
- `.yy` or `.yyp` metadata updates
- project-wide rename planning
- formatter layout decisions. **The formatter never repairs invalid syntax and only formats valid AST.**
- transpilation or runtime patching
- recovering from non-parseable syntax; if the file cannot be parsed into an AST, ESLint rules usually do not run because the parser fails before rule traversal starts. **Codemod/fixer commands are responsible for repairing non-parsable source text to restore parsability.**

If a rule needs global correctness, emit a diagnostic and point to a refactor workflow instead of applying a risky autofix.

## Working Approach

Before writing or changing a rule:

1. Classify the behavior as format, lint, semantic, or refactor ownership.
2. Confirm the rule can operate correctly on a single file.
3. Search for existing rule helpers, parser services, and similar tests.
4. Design diagnostics, messages, and fix safety before editing implementation.
5. Add tests for valid, invalid, fixed, and unsafe cases.

Implementation should:

- use ESLint rule APIs idiomatically
- keep fixes minimal, deterministic, and local to the file
- preserve exact ranges and comments unless intentionally fixing them
- report unsafe fixes through the shared unsafe-fix pattern
- keep rule options narrow and justified
- reuse core AST and traversal helpers rather than duplicating tree walking

## Rule Design

Good GML lint rules are:

- specific about the bad pattern
- clear about why it matters
- conservative about autofixes
- faithful to real GameMaker behavior
- consistent with existing rule naming and message style
- tested against edge cases, not only happy paths

Use established libraries when they reduce risk, but avoid pulling in dependencies for simple syntax checks that the existing parser, ESLint APIs, or core helpers already cover.

## Fix Safety

Autofixes must be safe within the local file.

- A fix may rewrite syntax or content only when the rule has enough local evidence.
- A fix must not require scanning another file to prove correctness.
- A fix must not update project metadata.
- A fix must not rely on downstream formatter behavior to become syntactically valid.
- A fix should emit formatter-normalized text when it synthesizes new code.

Examples that belong elsewhere:

- global rename transactions belong in refactor
- `globalvar` migration belongs in refactor
- pure whitespace layout belongs in format
- large project indexing belongs in semantic or refactor

## Parser Service Contract

Rules should consume language-specific information through parser services rather than reaching into parser internals.

- Treat parser services as a typed public contract.
- Avoid deep imports from parser implementation files.
- Keep parser service data immutable from the rule's perspective.
- Add tests when parser service shape changes.

## Testing Expectations

Add or update tests for:

- valid examples
- invalid examples
- autofix output
- no-fix or unsafe-fix cases
- malformed or partially parsed input if the rule supports token-phase behavior
- GameMaker-specific syntax that could be confused with JavaScript patterns

Do not modify protected `.gml` golden fixtures unless explicitly permitted.

## Checklist

Before finishing lint work, verify:

1. The rule belongs in lint and remains single-file scoped.
2. Fixes are safe and deterministic.
3. Project-aware behavior is reported, not fixed.
4. Formatter-only behavior stayed in the formatter.
5. Tests cover diagnostics and fix output.
6. Parser services and public exports remain typed and stable.

## Prohibited Patterns

- Cross-file writes from lint rules.
- Project index builders or rename planners in lint.
- Using lint rules to hide formatter gaps.
- Broad options that create multiple incompatible code styles.
- Dynamic imports, `require()`, `any`, or non-null assertions to avoid proper typing.
