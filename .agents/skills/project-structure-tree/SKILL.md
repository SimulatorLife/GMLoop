---
name: project-structure-tree
description: Use this skill to inspect the repository layout by running the root package script `tree`.
---

# Project Structure Tree

## Purpose

Use this skill when you need a quick, consistent view of the repository file structure before making changes.

## Required Command

Run the package script from the repository root:

```bash
pnpm run tree
```

## Usage Guidance

- Run `pnpm run tree` early when orienting in the codebase.
- Use the output to locate workspaces, tests, and target files.
- Re-run it after large structural changes to confirm directory placement.

## Notes

- This script already excludes noisy/generated paths (such as `node_modules`, `vendor`, and `dist`).
- Prefer this script over ad-hoc `tree` command variants so all agents see the same filtered view.
