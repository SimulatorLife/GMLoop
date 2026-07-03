# GMLoop Agent Pack

`@gmloop/agent-pack` publishes GMLoop's vendor-neutral Auto-Game Agent Skills and portable GameMaker project guidance as ordinary files.

Install the raw resources without installing the rest of GMLoop:

```bash
npm install -D @gmloop/agent-pack
```

The package has no standalone CLI and performs no postinstall project mutation. Consumers can inspect, copy, or point compatible tooling at `node_modules/@gmloop/agent-pack/skills/` directly.

The GMLoop Auto-Game UI exposes read-only previews of the packaged project guidance, gitignore entries, and skill resources before initialization. These are package-source previews only; project-owned files remain authoritative and are never replaced by previewing them.

When the main GMLoop CLI is available, initialize or update a GameMaker project with:

```bash
gmloop agent-pack init --path path/to/Game.yyp
```

This materializes skills under `<game-project>/.agents/skills/`, adds project guidance as `AGENTS.md` when that path is not project-owned, and writes `.gmloop/agent-pack.json` solely for package version and file provenance. By default it also creates or extends the project-root `.gitignore` with `.gmloop/`, `.gmcache/`, `node_modules/`, `.playwright-mcp/`, and `.agents/skills/**/gmloop-*`; pass `--no-gitignore` to leave that file untouched. Existing ignore rules are preserved and equivalent entries are not duplicated. The guidance defines a vendor-neutral autonomous development lifecycle for orienting, choosing a player-visible outcome, implementing a bounded slice, validating and playing it, responding to evidence, and recording the next iteration. Updates replace only files that still match their previously installed package content. Project-authored or modified files are preserved and reported as conflicts.

The `skills/` directory is the collection inventory. Every GMLoop-provided packaged skill directory must start with `gmloop-`. Adding or removing a standard `gmloop-<name>/SKILL.md` directory requires no registry, hard-coded list, or skill-specific loader.

## Sharing Skills With GMLoop Development

Some skills are useful both for agents developing GMLoop itself and for agents working inside GameMaker projects through `@gmloop/agent-pack`. Those skills should have exactly one editable source of truth under the repository-development collection:

```text
.agents/skills/<source-skill-name>/SKILL.md
```

Expose that same skill through the agent pack by adding a symlink under this package's collection:

```bash
ln -s ../../../.agents/skills/<source-skill-name> src/agent-pack/skills/gmloop-<packaged-skill-name>
```

The symlink target must be a skill directory, not a direct `SKILL.md` file. The symlink name under `src/agent-pack/skills/` is the published package identity and must start with `gmloop-`.

The source skill's frontmatter `name` must match the symlink name under `src/agent-pack/skills/`. Direct Agent Skill validators resolve the symlink and compare `SKILL.md` frontmatter against that folder name, so a shared packaged skill must use the `gmloop-*` name in its canonical source file.

When adding a shared skill:

1. Put the canonical editable skill content in `.agents/skills/<source-skill-name>/SKILL.md`.
2. Add a symlink at `src/agent-pack/skills/gmloop-<packaged-skill-name>` pointing back to that directory.
3. Set the source `SKILL.md` frontmatter `name` to `gmloop-<packaged-skill-name>`.
4. Add or update tests that assert `discoverPackagedSkillNames()` includes the packaged `gmloop-*` name, the symlinked `SKILL.md` declares that same name, and initialization installs matching frontmatter.
5. Keep shared skill content self-contained and vendor-neutral when it is intended for GameMaker projects.
6. Do not copy the same `SKILL.md` into both collections; duplicated skill content will drift.

The agent-pack scanner must continue to treat symlinked directories as skill directories. Packaged skill directory names are authoritative, and shared source frontmatter must match those names directly rather than relying on install-time rewriting.

Important packaging note: npm and pnpm pack dry-runs currently omit symlinked skill directories from the raw tarball file list. The GMLoop CLI and UI use the workspace/package filesystem scanner and therefore include shared symlinked skills during local initialization and preview. Before publishing shared symlinked skills as raw installable package files, verify the pack artifact includes the dereferenced shared skill content or add an explicit packaging step that materializes those symlinks into package files.

Packaged tooling guidance is capability-oriented and discovery-first. It directs agents to the current MCP catalog and stable CLI help entrypoint rather than duplicating MCP tool names or schemas that evolve with GMLoop.

The pack provides GameMaker-specific skills and guidance; it is not an agent
orchestrator. The consuming agent manager retains model selection, scheduling,
permissions, approvals, retries, memory, budgets, queues, task routing, and
long-running workflow state. Pack content must remain vendor-neutral and must
not require a particular coordinator or agent framework.

## References
- [repomix](https://github.com/yamadashy/repomix)
- [fastcontext](https://github.com/microsoft/fastcontext)
- [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
- [mcp-server-qdrant](https://github.com/qdrant/mcp-server-qdrant)
