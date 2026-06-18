---
name: gamemaker-resources
description: Create and modify GameMaker resources through GMLoop's structured CLI and MCP tools. Use when working with objects, events, rooms, scripts, instances, project metadata, or resource relationships.
---

# GameMaker Resources

Use GMLoop's structured project, resource, object, room, script, refactor, and validation commands instead of editing GameMaker metadata as unstructured text. Inspect `gmloop --help` and the relevant subcommand help before assuming an option or payload shape.

## Inspect Before Mutation

1. Resolve the active `.yyp` and confirm the project root.
2. Inspect existing resources and relationships before proposing new ones.
3. Reuse established naming, folder, parent-object, room-layer, and event conventions.
4. Search for an existing resource that already owns the desired behavior.

Do not infer resource identities from filenames alone when GMLoop can return structured project metadata.

## Mutate Through Structured Tools

Prefer the narrowest GMLoop CLI or MCP command that owns the change. Keep resource creation, object-event edits, room-instance placement, script edits, and project metadata changes inside their structured command families.

Preserve stable resource names and identifiers unless the task explicitly requires a rename. When renaming, use the project-wide refactor transaction so references and metadata change together.

Do not hand-edit `.yyp`, `.yy`, or resource ordering as generic JSON. Do not copy opaque resource metadata from another project without resolving its dependencies.

## Verify Relationships

After mutation:

- Reinspect the changed resource through GMLoop.
- Confirm referenced sprites, objects, scripts, rooms, parents, and instances resolve.
- Check that object events exist in the intended event category and number.
- Confirm room instances are placed on the intended instance layer.
- Run the narrow resource or project validation command, then the relevant build or smoke test.

## Report

List every created, updated, renamed, or removed resource; the structured command or MCP tool used; the important relationships verified; and any build/runtime validation that could not be completed.
