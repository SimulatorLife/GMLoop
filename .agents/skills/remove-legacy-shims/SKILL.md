---
name: remove-legacy-shims
description: Use this skill to remove compatibility shims, legacy behavior wrappers, and import/export pass-through files by migrating call sites to direct ownership APIs.
---

# Remove Legacy Shims Skill

## Purpose

Use this skill when code includes compatibility layers, deprecated wrappers, legacy behavior preservation paths, or pass-through import/export files that obscure ownership and add unnecessary indirection.

The target state is direct usage of the owning API with no shim layer.

## Use This Skill When

- A function only forwards arguments to another function.
- A module only re-exports symbols from a different workspace/module.
- There are dual code paths for old and new behavior.
- API surfaces include deprecated aliases preserved for compatibility.
- A command or option is retained only to support old call formats.

## Do Not Do

- Do not add new wrappers to "minimize churn."
- Do not keep fallback/legacy branches once callers can be migrated.
- Do not create compatibility aliases for old names.
- Do not preserve import proxy files that only forward exports.

## Ownership Rules

- Behavior must live in the workspace that owns the domain.
- Callers should import from the correct public workspace API for cross-workspace usage.
- Internal workspace code should use direct relative imports to owned implementation.
- Remove pass-through files instead of moving wrappers around.

## Detection Workflow

1. Find likely wrappers:

```bash
rg "deprecated|legacy|compat|shim|alias|wrapper|fallback|backward|backwards"
```

2. Find pass-through re-export files:

```bash
rg "^export \* from|^export \{.*\} from" src --glob "**/index.ts"
```

3. Find trivial forwarding functions:

```bash
rg "return\s+[A-Za-z0-9_$.]+\(.*\);" src
```

4. For each candidate, verify whether it adds real domain behavior. If not, remove it and migrate call sites.

## Migration Workflow

1. Identify the true owning API.
2. Update all call sites to invoke/import the owner directly.
3. Delete wrapper symbols and compatibility branches.
4. Delete pass-through files that no longer provide owned API.
5. Tighten types so old legacy shapes are no longer accepted.
6. Update tests to validate only the forward-looking behavior.

## Validation Expectations

- Add or update tests where behavior/entry points changed.
- Ensure tests do not rely on deprecated names or compatibility paths.
- Run the repository validation commands unless the change is documentation-only:

```bash
pnpm run build:ts
pnpm run lint:quiet
pnpm run test
```

## Checklist

1. No new compatibility shims were introduced.
2. Deprecated wrappers/aliases in scope were removed.
3. Callers now use direct imports/calls to owning APIs.
4. No import/export proxy files remain in the changed area.
5. Tests and docs reflect the direct-only API.

## Definition of Done

- Legacy-preservation paths in scope are deleted.
- Ownership boundaries are clearer after the change.
- Public API usage is direct and unambiguous.
- No behavior is hidden behind wrapper indirection.
