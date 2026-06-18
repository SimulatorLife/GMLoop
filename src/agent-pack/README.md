# GMLoop Agent Pack

`@gmloop/agent-pack` publishes GMLoop's vendor-neutral Auto-Game Agent Skills and portable GameMaker project guidance as ordinary files.

Install the raw resources without installing the rest of GMLoop:

```bash
npm install -D @gmloop/agent-pack
```

The package has no standalone CLI and performs no postinstall project mutation. Consumers can inspect, copy, or point compatible tooling at `node_modules/@gmloop/agent-pack/skills/` directly.

When the main GMLoop CLI is available, initialize or update a GameMaker project with:

```bash
gmloop agent-pack init --path path/to/Game.yyp
```

This materializes skills under `<game-project>/.agents/skills/`, adds project guidance as `AGENTS.md` when that path is not project-owned, and writes `.gmloop/agent-pack.json` solely for package version and file provenance. Updates replace only files that still match their previously installed package content. Project-authored or modified files are preserved and reported as conflicts.

The `skills/` directory is the collection inventory. Adding or removing a standard `<name>/SKILL.md` directory requires no registry, hard-coded list, or skill-specific loader.
