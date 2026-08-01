---
name: merge-conflict-resolution
description: Resolve merge, rebase, cherry-pick, formatter, generated-file, and commit-history conflicts safely while minimizing unrelated churn.
---

# Conflict Resolution & Merge Hygiene Skill

## Purpose
Resolve merge, rebase, cherry-pick, and formatter conflicts safely while preserving repository conventions, minimizing accidental churn, and maintaining a clean commit history.

Resolve merge, rebase, cherry-pick, and formatter conflicts safely while preserving repository conventions, minimizing accidental churn, and maintaining a clean commit history.

This skill prioritizes:

* Minimal diffs
* Preservation of intent from both branches
* Deterministic formatter/linter output
* Avoidance of unrelated file churn
* Safe handling of generated artifacts and golden files

---

# Core Principles

1. Never blindly accept "ours" or "theirs" for large conflicts.
2. Avoid introducing unrelated formatting or refactors during conflict resolution.
3. Resolve semantic conflicts first, formatting second.
4. Generated files should usually be regenerated, not hand-edited.
5. Keep merge commits mechanically clean and easy to review.
6. Minimize touched lines outside true conflict regions.
7. Preserve repository conventions, tooling versions, and golden outputs.
8. Prefer deterministic workflows over manual patching.

---

# Conflict Resolution Workflow

## 1. Assess the Situation

Identify:

* Current branch
* Base/target branch
* Conflict type:

  * merge
  * rebase
  * cherry-pick
  * formatter/tooling drift
  * generated artifact mismatch

Inspect repository state:

```bash
git status
git branch --show-current
git log --oneline --graph --decorate -20
```

Review pending scope:

```bash
git diff --stat origin/<base>...HEAD
```

Understand:

* Why the conflict happened
* Which side contains newer architectural intent
* Whether tooling drift is involved
* Whether generated artifacts are stale

---

## 2. Normalize Tooling First

Formatter/linter mismatches create avoidable conflicts.

Before resolving conflicts:

```bash
git fetch origin
git worktree add ../base-format origin/<base>
```

Validate the base branch formatter output:

```bash
cd ../base-format
pnpm install
pnpm run format
pnpm run lint:fix
git status --short
```

If formatter output changes the base branch unexpectedly:

* STOP
* Do not proceed with the merge
* Raise a follow-up issue instead

Back in the PR branch:

```bash
git checkout origin/<base> -- eslint.config.js ".prettier*" .editorconfig
```

Also restore any repository-specific tooling files that influence formatting or ordering:

* prettier configs
* eslint configs
* biome configs
* tsconfig ordering rules
* import sort configs
* workspace configs

Reinstall dependencies if needed:

```bash
pnpm install --recursive --force
pnpm run format
pnpm run lint:fix
```

Inspect the resulting diff carefully:

```bash
git status --short
git diff
```

Mechanical formatter changes may be committed separately if appropriate.

Remove temporary worktree:

```bash
git worktree remove ../base-format
```

---

# 3. Prepare a Clean Merge Environment

Refresh refs:

```bash
git fetch origin
git remote -v
```

Ensure branch is current:

```bash
git switch <branch>
```

If branch does not exist locally:

```bash
git switch --track origin/<branch>
```

Abort if unrelated changes exist:

```bash
git status --short
```

Only expected normalization or conflict-resolution files should appear.

---

# 4. Perform the Merge Safely

Prefer non-destructive merge flow:

```bash
git merge --no-commit --no-ff origin/<base>
```

Alternative:

* `git rebase origin/<base>` if repository policy prefers rebasing

---

# 5. Resolve Conflicts Carefully

Inspect conflicts:

```bash
git status
git diff --merge
```

For each file:

1. Understand BOTH sides
2. Preserve intended behavior
3. Avoid accidental deletions
4. Avoid whitespace churn
5. Keep surrounding code untouched

After resolving a file:

```bash
git diff <file>
```

Stage incrementally:

```bash
git add <file>
```

Do NOT bulk-stage unresolved work.

---

# 6. Generated Files & Artifacts

Generated artifacts should usually be regenerated.

Examples:

* lockfiles
* snapshots
* golden outputs
* generated docs
* compiled schemas
* parser outputs
* codegen artifacts

Prefer:

```bash
pnpm run build
pnpm run generate
pnpm test -u
```

Avoid hand-editing generated outputs unless explicitly required.

---

# 7. Handle Formatter Conflicts Correctly

If both branches reformatted the same files differently:

1. Resolve semantic conflicts FIRST
2. Apply canonical formatter SECOND
3. Re-run formatting LAST

Never manually preserve conflicting formatting styles.

---

# 8. Validate Thoroughly

Run all relevant validation:

```bash
pnpm test
pnpm run lint
pnpm run typecheck
pnpm run build
```

Also validate:

* snapshots
* golden fixtures
* generated outputs
* CLI behavior
* workspace integrity
* CI workflows

Re-check final scope:

```bash
git diff --stat origin/<base>...HEAD
```

Ensure only intentional files changed.

---

# 9. Commit Hygiene

Merge commits should clearly explain:

* Why conflicts occurred
* How they were resolved
* Any intentional precedence decisions

Example:

```text
Resolve merge conflicts with formatter normalization

- Synced formatter configs from main
- Re-generated snapshots
- Preserved new CLI workspace behavior
- Avoided unrelated formatting churn
```

---

# 10. Final Verification

Ensure branch is fully up to date:

```bash
git fetch origin
git merge --ff-only origin/<base>
```

or:

```bash
git rebase origin/<base>
```

Expected result:

```text
Already up to date.
```

---

# Additional Repository Safety Rules

## Golden Files

Never modify golden fixtures unintentionally.

If golden outputs changed:

* verify root cause
* confirm behavior changes are intentional
* regenerate deterministically

---

## Lockfiles

Never manually edit lockfiles unless absolutely necessary.

Prefer:

```bash
pnpm install
```

Then review resulting changes carefully.

---

## Large Refactors

Do not combine:

* conflict resolution
* formatting migrations
* dependency upgrades
* architectural rewrites

into a single commit unless explicitly required.

---

## CI Failures During Merge

If CI fails after conflict resolution:

1. Reproduce locally
2. Identify whether:

   * tooling drift
   * stale generated files
   * dependency mismatch
   * hidden merge regression
     caused the issue
3. Fix root cause instead of patching symptoms

---

# Preferred Resolution Order

When conflicts stack together, resolve in this order:

1. Tooling/config drift
2. Dependency/install state
3. Source conflicts
4. Generated artifacts
5. Formatting
6. Snapshot/golden updates

---

# Anti-Patterns

Avoid:

* blanket "accept incoming"
* force-pushing unresolved history
* mixing refactors into merge fixes
* editing generated files manually
* formatting unrelated files
* resolving conflicts without understanding intent
* staging everything with `git add .`
* silently dropping one side of a semantic conflict

---

# Success Criteria

A successful merge resolution:

* builds successfully
* passes tests
* preserves intended behavior
* minimizes unrelated churn
* keeps history understandable
* produces deterministic formatter output
* leaves the branch fully up to date
