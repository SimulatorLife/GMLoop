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

The `skills/` directory is the collection inventory. Every GMLoop-provided skill directory and its `SKILL.md` frontmatter name must start with `gmloop-`. Adding or removing a standard `gmloop-<name>/SKILL.md` directory requires no registry, hard-coded list, or skill-specific loader.

Packaged tooling guidance is capability-oriented and discovery-first. It directs agents to the current MCP catalog and stable CLI help entrypoint rather than duplicating MCP tool names or schemas that evolve with GMLoop.
