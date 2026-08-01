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

- ESLint language integration for GML
- rule metadata, messages, diagnostics, and docs surfaced through rule catalogs
- local single-file autofixes. **Lint rule autofixes are responsible for fixing valid-but-forbidden syntax (e.g., style violations or deprecated patterns that are still syntactically valid).**
- safe token-based fixes that can run before full AST success when explicitly designed
- content-aware single-file rewrites such as doc-comment normalization
- parser services that expose GML-specific metadata to rules

Lint does not own:

- cross-file edits
- project "semantic graph" (a.k.a. "graph index") mutation
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

## Rule Ownership Consolidation

When changing existing lint rules, first check whether the behavior duplicates, recreates, or partially overlaps a rule from another lint namespace.

The target state is one canonical owner for each lint behavior. If a custom GML rule is an exact or near-exact recreation of a Feather-owned diagnostic, migrate the complete and safest behavior into the Feather rule, then remove the duplicate GML rule entirely. Do not leave aliases, compatibility shims, duplicate docs, duplicate config examples, or stale catalog entries unless explicitly required by a migration plan.

When consolidating ownership:

* Preserve behavior, not filenames.
* Prefer the metadata-correct canonical rule ID.
* Move stronger implementation details with the behavior.
* Keep safer fix restrictions even when moving into a different rule namespace.
* Preserve comment handling, scope checks, constructor awareness, malformed-input behavior, and edge-case protections.
* Remove the old rule from registrations, exports, recommended configs, docs, examples, catalogs, fixtures, and generated listings.
* Consolidate tests under the new owning rule rather than duplicating coverage.

If a GML rule and a Feather rule only partially overlap, do not blindly merge them. Decide which rule owns the rewrite capability and which rule should remain diagnostic-only. Remaining overlapping rules may both report diagnostics, but only the canonical owner should provide fixes.

## Canonical Fix Ownership

Autofix ownership must be explicit.

A rule may own a fix only when:

* the transformation belongs to that rule’s semantic category
* the rule has enough local evidence to prove the fix is safe
* the fix does not require project-wide knowledge
* the fix does not rely on another tool to repair syntax afterward
* repeated autofix passes converge without oscillation or overlapping edits

When behavior moves between rules, the complete safe-fix behavior should move with it. Do not downgrade a mature GML implementation just because the destination rule currently has weaker logic. Instead, upgrade the canonical rule and retire the duplicate.

If the safer outcome is report-only behavior, remove `fixable` metadata and strip runtime fixes or suggestions consistently. Rule metadata, generated catalogs, and actual runtime behavior must agree.

## Conflict Handling

Maintain an explicit internal conflict registry for known overlapping rule behavior.

The registry should make conflicts visible and enforce the target state centrally. Conflicting non-owner rules should continue reporting useful diagnostics, but they should not expose autofixes or suggestions. This prevents duplicate edits, overlapping fixes, autofix oscillation, and misleading catalog metadata.

Do not solve conflicts ad hoc inside individual rules when a shared conflict mechanism is available.

## Namespace Boundary

Use namespace ownership as an API contract.

GML-specific rules should own behavior that is genuinely specific to the custom GML lint layer. Feather rules should own behavior that corresponds to Feather diagnostics or metadata categories. Formatter-only behavior belongs in format. Project-aware behavior belongs in refactor. Semantic indexing belongs in semantic services or refactor tooling.

When a behavior could fit multiple places, choose the owner that best matches the diagnostic’s public meaning and long-term catalog surface, not whichever implementation currently has the most code.

## Removal Standard

When retiring a duplicate rule, removal must be complete.

Check and update:

* rule implementation files
* rule registration maps
* public exports
* recommended and all configs
* generated catalogs
* README tables
* rule docs
* examples
* fixture names
* integration configs
* protected golden files, when explicitly authorized
* tests that reference the old rule ID

Do not leave stale references to removed rule IDs. Do not preserve removed IDs as aliases unless the migration explicitly calls for backwards compatibility.

## Test Consolidation

When moving behavior from one rule to another, move the tests with it.

Consolidated tests should prove:

* the canonical rule reports the migrated diagnostics
* the canonical rule preserves previous safe fixes
* unsafe cases remain no-fix or report-only
* comments, scopes, constructors, shadows, and malformed inputs are still handled correctly
* removed rule IDs are absent from public plugin surfaces
* recommended config produces equivalent migrated behavior
* repeated autofix passes converge cleanly
* conflicting rules report consistently, but only the owning rule fixes

Prefer renaming and consolidating test suites over copying tests into parallel namespaces.

## Agent Workflow For Existing Rules

Before modifying an existing lint rule, the agent should:

1. Identify whether the behavior is unique, duplicate, or partially overlapping.
2. Determine the canonical owner.
3. Decide whether the current rule should remain, become report-only, or be removed.
4. Preserve the strongest existing implementation when migrating behavior.
5. Update metadata so declared fixability matches runtime behavior.
6. Consolidate tests under the canonical owner.
7. Remove stale docs, examples, configs, exports, and catalogs.
8. Run targeted rule tests before broader build, lint, and test checks.

The preferred end state is fewer duplicate rules, clearer public ownership, safer fixes, and no loss of valid autofix capability.
