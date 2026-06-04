# Architectural Audit: Project-Index Parsing Flattening (2026-06-04)

## Design rationale

The daily audit started with a repository-wide structure survey using `pnpm run tree`, then narrowed to shallow modules and single-purpose directories. The clearest structural inefficiency was the semantic project-index parser-error formatting seam: `src/semantic/src/project-index/parsing/` contained only a barrel file and one implementation file, while its behavior is used only by the project-index parser facade and exported through the project-index surface.

Current pain points:

- The `parsing/` directory introduced an extra hierarchy level without owning a cohesive subsystem.
- The project-index parser facade deep-imported through `parsing/syntax-error-formatter`, fragmenting the project-index error-reporting concept.
- The directory name suggested a broader parsing subdomain, but the code only formats parser-originated errors for project-index reporting.

Target architecture:

- Keep parser ownership unchanged: syntax production remains in `@gmloop/parser`; semantic project indexing only consumes parser results and formats project-index diagnostics.
- Keep `@gmloop/semantic` project-index helpers flat when a module belongs directly to the project-index reporting flow and does not justify a subdomain.
- Preserve the public `ProjectIndex` export surface so external callers continue importing through `@gmloop/semantic` without deep paths.

## Migration and fallback plan

This is a deliberately narrow file move rather than a sweeping hierarchy rewrite. The migration moves `syntax-error-formatter.ts` directly under `src/semantic/src/project-index/`, updates the project-index barrel export and internal facade import, and removes the now-empty `parsing/` directory. If an unexpected downstream issue appears, the fallback is a straight revert of this move because no runtime behavior, public symbol name, or test fixture content changed.

Broader project-index directory reshaping is deferred to follow-up audits so this change stays reviewable and under the requested changed-file budget.

## Before and after

Before:

```text
src/semantic/src/project-index/
├── gml-parser-facade.ts
├── index.ts
└── parsing/
    ├── index.ts
    └── syntax-error-formatter.ts
```

After:

```text
src/semantic/src/project-index/
├── gml-parser-facade.ts
├── index.ts
└── syntax-error-formatter.ts
```

## Behavioral impact

No public API or system behavior changes. `formatProjectIndexSyntaxError` remains exported by `src/semantic/src/project-index/index.ts`, and the parser facade still decorates parser errors with the same project-index message, location, and excerpt metadata.
