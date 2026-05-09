# Stitch Parser Assessment

## Executive summary
- Investigated `https://github.com/bscotch/stitch` (package `packages/parser`) to compare their Chevrotain-based GML parser + project model with our ANTLR-driven formatting/transpiler stack.
- Captured how their `Project`/`Code` machinery loads `.yyp`/`.yy`, keeps native metadata up to date, and emits diagnostics via an `EventEmitter`, then exercised it against the bundled sample project to see its runtime behavior.
- Documented the key architectural differences, the per-feature trade-offs, and concrete next steps for deciding whether to reuse any Stitch components or keep our current pipeline isolated.

## Process log
1. `pnpm install` inside `/tmp/stitch/packages/parser` to pull `@bscotch/yy`, `@bscotch/stitch-config`, `magic-string`, and the rest of the parser dependencies. The install emits warnings about missing `dist/cli.mjs` bins from sibling packages, but it finishes and populates `node_modules`.
2. `pnpm install` at the stitch workspace root so that every workspace (especially `packages/yy` and `packages/stitch-config`) has its dependencies resolved, then `pnpm -r run build` to generate `dist` outputs for `@bscotch/yy`, `@bscotch/gml-parser`, and friends. This step is required before running the parser because the TypeScript sources import the built packages (`dist/index.js`). The build produces a lot of Svelte/Vite warnings but ultimately succeeds and generates `packages/parser/dist`.
3. Executed the runtime experiment shown in the “Operational experiment” section below: `node --input-type=module` script that imports `Project` from `packages/parser/dist/index.js`, initializes the sample `packages/parser/samples/project/project.yyp`, hooks `onLoadProgress`/`onDiagnostics`, and reports asset counts plus diagnostics. The script logs how the parser falls back to the bundled `GmlSpec.xml`, loads 19 assets, and surfaces 21 diagnostics (some of which point at the sample `Recovery.gml`).

## Stitch parser architecture

### Project model and asset graph
- `Project.initialize()` (see `packages/parser/src/project.ts`) reads the `.yyp` manifest, discovers every resource, and stores them in `this.assets: Map<string, Asset>` with helpers such as `getAssetByName()`, `renameAsset()`, `removeAssetByName()`, `createFolder()`, and `syncIncludedFiles()`.
- Each resource becomes an `Asset` (`packages/parser/src/project.asset.ts`) that maps the `YyResource` metadata to a GML/YY handling surface, tracks `gmlFiles`, exposes `isScript/isObject` guards, wires native symbol tables, and exposes getters such as `name`, `dir`, and `sprite` (with safety checks).
- The `Code` instances in `packages/parser/src/project.code.ts` wrap individual GML files, maintain diagnostics, expose `content`, and use `magic-string` when rewrites are necessary. Diagnostics are typed via the exported `Diagnostic` and `Reference` helpers defined in `project.diagnostics.ts` and `project.location.ts`, and the project emits payloads to `onDiagnostics` callbacks as parsing occurs.
- The project keeps a `dirtyFiles` queue and an `EventEmitter` (`new EventEmitter()` at `packages/parser/src/project.ts:43`) to signal updates. The same file also orchestrates native metadata loading from `@bscotch/gamemaker-releases`, stitches config from `@bscotch/stitch-config`, and tracks the `native` symbol table for each GameMaker version.

### Parser stack and tooling
- The parser is hand-built with Chevrotain (`packages/parser/src/lexer.ts`, `parser.ts`, `visitor/*.ts`). It outputs a CST and type definitions through `scripts/generate-cst-dts.mjs`, which writes `gml-cst.d.ts` so downstream code gets a typed view of every node kind.
- Visitors/processors such as `visitor.identifierAccessor.ts`, `visitor.functionExpression.ts`, and `visitor.processor.ts` walk the CST to provide diagnostics, scope helpers, and identifier discovery that Stitch’s VSCode extension consumes for go-to-definition and rename.
- The parser reruns lexing to capture hidden tokens (comments/whitespace) and uses the `Project`/`Code` model to track symbol tables even before formatting occurs. There is no Prettier printer here; instead, the focus is on project introspection, asset manipulations, and rewriting `.yy` metadata via `@bscotch/yy`.

### Metadata, dependencies, and runtime behavior
- The package depends on `@bscotch/yy`, `@bscotch/stitch-config`, `@bscotch/gamemaker-releases`, `magic-string`, `xml2js`, `zod`, and `chevrotain`, which together provide XML parsing, release-specific native data, JSON-schema validation, and rewriting helpers.
- During the experiment we saw log lines such as “No stitch config found, looking up runtime version,” “Fetching list of GameMaker releases…,” and “Falling back to default GmlSpec.xml included with Stitch,” which shows how the parser prefers a local `stitch.config.json` but can recover by loading embedded spec data when it is absent.
- Diagnostics are emitted as objects like `{ filePath, diagnostics: Diagnostic[] }`, with an empty diagnostics list for extension files (see script output), so watchers have a consistent payload even when no rules fire.

## Our parser & workspace architecture
- Our parser stack (`src/parser/`) is ANTLR-driven: grammars (`GameMakerLanguageLexer.g4` and `GameMakerLanguageParser.g4`) under `src/parser/` generate `./generated/**`, and `src/parser/src/gml-parser.ts` wraps the generated classes with comment extraction, location trimming, escape normalization, and `ParserOptions` (`src/parser/src/types/index.ts`). This parser produces a structured AST optimized for our Prettier plugin and eventual transpiler.
- The Prettier plugin (`src/format/`) uses that AST plus our `semantic` layer (`src/semantic/`) to format GML, hoist loop lengths, condense structs, enforce global variable rules, and feed our CLI (`src/cli/`). The `README.md` and `docs/target-state.md` describe how the semantic index tracks identifier casing, scopes, and project detection, and we already own the tooling around `feather` metadata, live reloading, and future refactor support in `src/refactor/`.
- `resources/` stores parser metadata such as identifier inventories and the Feather dataset, which mirrors what Stitch’s `@bscotch/gamemaker-releases` and native spec files provide but remains under our control and is tailored to formatting concerns.
- Our CLI wrapper sits in `src/cli/` and exposes commands through `src/cli/src/commands/`, so we expose all tooling through a single, discoverable entry point (per `AGENTS.md`). We do not currently maintain a full `.yyp` project model or asset rename helpers within the formatter workspace; that logic lives externally in Stitch.

## Side-by-side comparison
| Concern | Stitch (`@bscotch/gml-parser`) | Our workspace (`GMLoop` + `/parser`) |
| --- | --- | --- |
| Parser generator | Chevrotain with hand-written lexer, parser, and visitor layers (`packages/parser/src/lexer.ts`, `parser.ts`, `visitor/`). | ANTLR 4 grammars (`GameMakerLanguage*.g4`) with generated runtime under `src/parser/generated`. |
| AST/CST | Produces a typed CST (`gml-cst.d.ts`) plus visitors; comments are attached at the project/asset level. | Produces formatted AST nodes for Prettier/Transpiler via `src/parser/src/ast/`; comment/whitespace attachment is built into `gml-parser.ts`. |
| Project scope | Deep project model: `.yyp` parsing, asset trees, rename/delete helpers, `Code` objects, diagnostics, `.yy` rewrites. | Focused on formatting semantics, AST normalization, and eventually JS transpilation; project-aware logic lives in `semantic` and CLI tooling rather than a generalized `Project` class. |
| Metadata feeds | Relies on `@bscotch/gamemaker-releases`, release-specific specs, and `@bscotch/yy` topologies for `.yy` XML handling. | Maintains `resources/feather` and semantic metadata plus future plans for identifier casing and live reload (see `docs/target-state.md`). |
| Diagnostics | Evented diagnostics carried via `onDiagnostics` payloads from `Project`. | Formatter diagnostics mostly surface through Prettier errors and semantic checks; no project-level event emitter yet. |
| Runtime/platform | Built/tested mostly on Windows; script logs show fallback to embedded spec data when config is absent. | Node.js 25+ with macOS/Linux support baked into repo instructions; `AGENTS.md` forbids `.js` sources or dynamic imports. |
| Dependencies | `chevrotain`, `magic-string`, `zod`, `@bscotch/yy`, `@bscotch/stitch-config`, `@bscotch/gamemaker-releases`. | Prettier + ANTLR + our shared `/*` packages; per workspace instructions keep formatting deps localized to `plugin`. |

## Operational experiment
Ran this script from the stitch root after building the workspace:

```bash
cd /tmp/stitch
node --input-type=module <<'EOF'
import path from 'node:path';
import { pathy } from '@bscotch/pathy';
import { Project } from './packages/parser/dist/index.js';
const samplePath = path.resolve('packages/parser/samples/project/project.yyp');
console.log('sample project', samplePath);
const diagnostics = [];
const project = await Project.initialize(samplePath, {
  onLoadProgress: (increment, message) => {
    console.log('progress+', increment, message ?? '');
  },
  onDiagnostics: (payload) => diagnostics.push(payload),
});
console.log('asset count', project.assets.size);
console.log('asset kinds',
  Array.from(project.assets.values()).reduce((acc, asset) => {
    acc[asset.assetKind] = (acc[asset.assetKind] ?? 0) + 1;
    return acc;
  }, {}),
);
console.log('configs', project.configs);
console.log('scripts (first five)',
  Array.from(project.assets.values())
    .filter((asset) => asset.isScript)
    .slice(0, 5)
    .map((asset) => asset.name),
);
console.log('diagnostics count', diagnostics.length);
if (diagnostics.length) {
  console.log('diag sample', {
    filePath: diagnostics[0].filePath,
    items: diagnostics[0].diagnostics.length,
  });
}
console.log('Withing.gml files',
  project.getAssetByName('Withing')?.gmlFiles &&
    Array.from(project.getAssetByName('Withing')!.gmlFiles.keys()).map((p) => pathy(p).basename),
);
EOF
```

Output highlights:

```
progress+ 5 Loaded project file
Loading spec for module Base
progress+ 5 Loaded GML spec
progress+ 1 Loaded 19 resources
progress+ 1 Parsing resource code...
asset count 19
asset kinds { extensions: 1, rooms: 1, shaders: 1, sprites: 1, objects: 6, scripts: 9 }
configs [ 'Default' ]
scripts (first five) [ 'Jsdocs', 'FunctionSelf', 'Futures', 'Complicated', 'Generics' ]
diagnostics count 21
diag sample { filePath: '/private/tmp/stitch/packages/parser/samples/project/extensions/Extension1/Extension1.yy', items: 0 }
Withing.gml files [ 'withing.gml' ]
```

The parser also emitted a `SYNTAX ERROR` for `scripts/Recovery/Recovery.gml` while loading assets, illustrating how diagnostics surface malformed tokens before formatting occurs.

## Integration opportunities & risks
- **Opportunities**
  - Treat the `Project`/`Code` emitter as a backend for future refactors: it already tracks diagnostics, asset hierarchies, and symbol tables and emits events that could feed our CLI tooling (see `packages/parser/src/project.ts`).
  - Reuse the `.yy` reading/writing workflow from `@bscotch/yy` whenever we need to add/remove resources in a GameMaker project without reimplementing XML plumbing; the package already wires into `Yy.write`, `Yy.read`, and typed schema validators (e.g., `yy.*.schema.ts`).
  - Leverage their `gml-cst.d.ts` generation script as a reference when we map ESTree nodes to our AST, ensuring we do not miss node kinds that Stitch already covers.
- **Risks**
  - The `Project` API is tightly coupled to `stitch.config.json`, Windows-validated release metadata, and Svelte/Vite tooling; adopting it would introduce large dependencies and potentially violate our “no CLI scripts outside `src/cli/src/commands`” rule unless we wrap their functionality carefully.
  - The parser's CST-first model differs from our AST-based printer. Using it directly for formatting would force us to rebuild comment attachment, whitespace handling, and `ParserOptions` logic already encoded in `src/parser/src/gml-parser.ts`.
  - Stitch expects to be the source of truth for `.yyp` assets; replacing our `semantic` index with theirs would duplicate functionality and require rewriting existing CLI commands.

## Pros / Cons refresher
- **Pros**
  - Rich project model (asset traversal, rename/delete, diagnostics, `magic-string` rewrites) that we could tap for CLI automation.
  - Typed CST/visitor ecosystem that mirrors our AST nodes and could act as a regression reference when we add new node kinds or ESTree output.
  - Mature `.yy` schema validation via `@bscotch/yy` and release-aware native data through `@bscotch/gamemaker-releases`.
- **Cons**
  - Windows-focused testing/support claims and platform-specific scripts; we would need to re-validate on macOS/Linux before relying on it.
  - Additional dependencies, configuration, and metadata duplication (project index, `resources`, `semantic`), which would increase our maintenance surface area.
  - CST → AST conversion requirements and overlap with our semantic plans make wholesale adoption costly.

## Ideas / inspiration
- Mirror their `Project`/`Code` event emitter pattern when running CLI refactors/watchers so progress/diagnostics can be streamed consistently (see `packages/parser/src/project.ts`).
- Use `gml-cst.d.ts` generation as a checklist when extending our AST; it guarantees we do not miss tokens/kinds that Stitch already types.
- Bring in `@bscotch/yy` or a subset of its schema+I/O helpers when we add CLI commands that need to mutate `.yy`/`.yyp` files (e.g., `AddResourceCommand`).
- Compare their native spec data (`packages/parser/src/types.*.ts`, `spine.ts`, `signifiers.ts`) with our `resources/`/`semantic` metadata to find any unique entries we might want to ingest.

## Next steps
1. Expand the side-by-side prototype by converting Stitch diagnostics into the event format expected by `src/cli/src/commands`. Capture how their `diagnostics` array differs from the semantic snapshot our formatters currently produce.
2. Audit AST mappings between `gml-cst.d.ts` and `src/parser/src/ast` to identify node kinds we do not handle yet; document any gaps.
3. Decide whether to treat `@bscotch/gml-parser` as a regression/reference tool (e.g., run their parser whenever our AST parser flags a boundary case) or to keep our stack isolated and only borrow metadata helpers like `@bscotch/yy`.

## Follow-up clarifications (from Q&A)

### CST vs AST in this comparison
- Stitch's parser is CST-first: Chevrotain grammar rules emit concrete parse nodes that preserve token-level syntax details and punctuation (`packages/parser/gml-cst.d.ts`, `packages/parser/src/parser.ts`).
- Our parser is AST-first for downstream consumers: ANTLR parse output is transformed into an abstraction-oriented node model used directly by the plugin/transpiler (`src/parser/src/ast`, `src/parser/src/gml-parser.ts`).
- Practical implication: Stitch's CST can absolutely produce an AST through visitors, but adopting it as our primary parser would require rebuilding our AST mapping, comment attachment behavior, and parser option semantics.

### How Stitch renaming works
- Renaming is not a one-off text replace; it runs through a loaded `Project` model (`packages/parser/src/project.ts`) that knows assets/resources and symbol ownership, then updates both metadata (`.yy`, `.yyp`) and GML references.
- `Asset` and `Code` abstractions (`packages/parser/src/project.asset.ts`, `packages/parser/src/project.code.ts`) carry context for where symbols are defined and referenced; `magic-string` is used for controlled edits, and diagnostics/event callbacks report outcomes.
- The system is asset-aware first (scripts/objects/sprites/rooms + references), then source-editing second, which is useful for GameMaker correctness but heavier than pure formatter-level renames.

## Stitch launcher assessment (`packages/launcher`)

### What the launcher provides beyond parsing
- A version-management API around GameMaker IDE and runtime artifacts via `GameMakerLauncher`, `GameMakerIde`, and `GameMakerRuntime` (`packages/launcher/src/lib/GameMakerLauncher.ts`, `packages/launcher/src/lib/GameMakerIde.ts`, `packages/launcher/src/lib/GameMakerRuntime.ts`).
- Automated install/open/run flows:
  - `GameMakerLauncher.openProject(...)` installs/fetches the target IDE, validates runtime compatibility, sets active runtime, and opens the IDE.
  - `GameMakerLauncher.runProject(...)` installs a runtime (if needed), updates active runtime, and executes Igor for run/build commands.
- Feed + cache plumbing:
  - Uses `@bscotch/gamemaker-releases` release summaries and local cache refresh logic.
  - Maintains official runtime feeds and updates GameMaker runtime config files (`runtime_feeds.json`, `runtime.json`) (`packages/launcher/src/lib/GameMakerComponent.ts`, `packages/launcher/src/lib/utility.ts`).
- Direct CLI command execution wrappers for Igor, with compile/run success detection and log-file persistence (`packages/launcher/src/lib/GameMakerRuntime.command.ts`).

### Capabilities relevant to this codebase's automation goals
- Deterministic version pinning for automation:
  - Our watch/format/transpile workflows can run against a known IDE/runtime pair, reducing "works on my runtime" drift.
- Programmatic run/build orchestration:
  - The launcher can execute project run/build from Node and write machine-readable logs, which aligns with planned CLI automation.
- Discovery of GameMaker installation state:
  - `listWellKnownPaths()` and installed-version discovery can bootstrap environment validation commands in our CLI.

### Constraints and risks
- Platform risk is significant:
  - Installer execution hard-checks Windows (`runIdeInstaller` asserts `process.platform === "win32"`), and many paths depend on `%PROGRAMDATA%`/`%PROGRAMFILES%` conventions (`packages/launcher/src/lib/utility.ts`).
  - This is not portable automation for macOS/Linux contributors.
- External side effects:
  - `setActiveRuntime()` writes global GameMaker runtime state for all IDE installs, not just one project; this can surprise users with multiple projects.
- Licensing/runtime bootstrap fragility:
  - Runtime installation relies on a known bootstrap runtime (`2022.300.0.476`) and valid GameMaker credentials.
- Architectural fit:
  - Bringing launcher internals directly into parser/plugin layers would violate our workspace boundaries. If used, integration should sit in `src/cli/src/commands/` as an optional automation command path.

### Recommended leverage strategy for this monorepo
1. Add a thin CLI integration layer (in `src/cli/src/commands/`) that treats launcher as an optional external dependency and only enables launcher-backed commands on Windows.
2. Keep parser/plugin independent of launcher APIs; launcher should be used only for dev/runtime orchestration (open IDE, run/build, runtime pinning), not for AST or formatter semantics.
3. Add explicit safety UX in CLI commands before mutating active runtime (show current runtime + target runtime + confirmation mode in non-CI flows).
4. Start with read-only commands first:
  - environment doctor (known paths, installed IDE/runtime versions),
  - release lookup,
  - dry-run command rendering (stringified Igor command) before enabling install/run mutation paths.

### Suggested command ideas for our CLI
- `cli gamemaker doctor`: show discovered IDE/runtime installs, feed config files, active runtime state.
- `cli gamemaker run --runtime <version> --project <yyp>`: run via launcher with structured logs.
- `cli gamemaker open --ide <version> [--runtime <version>]`: deterministic IDE launch for a project.
- `cli gamemaker set-runtime --version <version> --dry-run`: preview and then optionally apply active runtime changes.

## Stitch yy integration plan (`packages/yy`)

### Scope and rationale
- `@bscotch/yy` is purpose-built for `.yy/.yyp` parsing/stringifying, including trailing commas, large integers, GameMaker key-order/format conventions, and schema validation (`Yy.read`, `Yy.write`, `Yy.schemas`).
- Our codebase currently has multiple custom `.yy` handling paths with mixed behavior:
  - one path uses `Core.parseGameMakerJson` (trailing comma tolerant),
  - another path uses `Core.parseJsonWithContext` (not GameMaker-specific),
  - refactor bridge logic currently relies on text/regex occurrence scanning in JSON files.
- Integrating `@bscotch/yy` should reduce parser/serializer drift and make asset rename/refactor behavior safer.

### Thorough audit focused on rename/refactor paths
- `src/semantic/src/identifier-case/asset-rename-executor.ts`
  - Reads resource metadata with `Core.parseJsonWithContext` and writes with `Core.stringifyJsonForFile`.
  - Updates references via generic `propertyPath` traversal and performs file renames directly.
  - This is the highest-value replacement target for `Yy.read`/`Yy.write`.
- `src/semantic/src/identifier-case/asset-renames/planner.ts`
  - Plans asset renames and reference mutations from project-index data.
  - Depends on `resourcePath`, `gmlRenames`, and `referenceMutations`; these structures should remain, but executor internals can move to `@bscotch/yy` I/O.
- `src/cli/src/modules/refactor/semantic-bridge.ts`
  - Adds `.yy` edits by regex scanning JSON string content (`findJsonStringOccurrences`).
  - Also contributes `.yy` file renames in `getAdditionalSymbolEdits`.
  - This should move away from text-offset edits for metadata files and use structured mutation plans backed by `@bscotch/yy`.
- `src/refactor/src/refactor-engine.ts`
  - Applies text edits blindly by character offsets and then file renames.
  - Works for `.gml`, but `.yy` edits sourced from regex offsets are fragile and should be handled as structured resource edits.
- `src/semantic/src/project-index/resource-analysis.ts`
  - Parses `.yy` via `Core.parseGameMakerJson` and discovers asset references by walking every object with a `path` field.
  - This broad heuristic can over-capture non-resource paths; `@bscotch/yy` schemas can support more precise per-resource extraction.

### Replacement map (what to replace, where)
| Current custom code | Replace with (`@bscotch/yy`) | Location |
| --- | --- | --- |
| `Core.parseJsonWithContext(raw)` for `.yy` files | `Yy.read(filePath, schema)` or `Yy.parse(text, schema)` | `src/semantic/src/identifier-case/asset-rename-executor.ts` |
| `Core.stringifyJsonForFile(...)` for `.yy` writes | `Yy.write(filePath, data, schema, yyp?)` | `src/semantic/src/identifier-case/asset-rename-executor.ts` |
| Regex-based `.yy` string occurrence detection | Schema-aware mutation plan (object-level updates) then `Yy.write` | `src/cli/src/modules/refactor/semantic-bridge.ts` |
| Generic deep scan of all `{ path: string }` fields for asset references | Typed extraction per `resourceType` using `Yy.schemas`/typed models | `src/semantic/src/project-index/resource-analysis.ts` |
| Mixed JSON parser behavior for GameMaker metadata | Single metadata I/O facade wrapping `@bscotch/yy` | new semantic domain module (see below) |

### Proposed architecture in this monorepo
1. Add a semantic-domain metadata adapter, e.g. `src/semantic/src/project-metadata/yy-adapter.ts`, exposing only:
   - `readResource(resourcePath, resourceType?)`
   - `writeResource(resourcePath, data, resourceType, yyp?)`
   - `readProjectManifest(yypPath)`
2. Keep parser/plugin boundaries intact:
   - parser remains GML -> AST only,
   - plugin remains AST formatting,
   - `.yy/.yyp` mutation/parsing lives under semantic/refactor orchestration only.
3. Route all asset rename writes through this adapter:
   - `asset-rename-executor` becomes planner + mutation orchestrator, not custom serializer.
4. Introduce typed metadata edit operations for refactor:
   - keep text edits for `.gml`,
   - use metadata operations for `.yy/.yyp` (no regex offsets).

### Migration plan (phased)
1. **Phase 1: I/O unification**
   - Implement `yy-adapter` with `@bscotch/yy`.
   - Switch `asset-rename-executor` read/write paths to adapter.
   - Keep existing rename planning (`asset-renames.ts`) unchanged.
2. **Phase 2: Refactor metadata safety**
   - In `GmlSemanticBridge.getAdditionalSymbolEdits`, stop emitting text edits for `.yy`; emit metadata mutation intents instead.
   - Extend refactor application pipeline to execute metadata mutations through adapter before/after `.gml` edits.
3. **Phase 3: Resource-analysis precision**
   - Replace generic `collectAssetReferences` walk with resource-type-aware extraction using parsed typed records from `@bscotch/yy`.
   - Preserve current output shape (`relationships.assetReferences`) to avoid downstream breakage.
4. **Phase 4: remove duplicate parsing utilities for metadata**
   - Restrict `Core.parseGameMakerJson` usage to non-semantic contexts or deprecate it for `.yy/.yyp` code paths once migration completes.

### Implementation status in this repository (current branch)
- Completed Phase 1:
  - Added semantic metadata adapter at `src/semantic/src/project-metadata/yy-adapter.ts` and exported it from `src/semantic/src/project-metadata/index.ts` plus `src/semantic/src/index.ts`.
  - Switched `src/semantic/src/identifier-case/asset-rename-executor.ts` to parse/stringify metadata through the new adapter.
  - Switched `src/semantic/src/project-index/resource-analysis.ts` metadata parse path to the adapter and dedicated parse-error guard.
- Completed Phase 2:
  - Replaced regex/string-offset `.yy` edits in `src/cli/src/modules/refactor/semantic-bridge.ts` with structured object mutation + metadata rewrite operations backed by `Semantic.parseProjectMetadataDocument`/`Semantic.stringifyProjectMetadataDocument`.
  - Extended the refactor contract with first-class metadata operations (`WorkspaceEdit.metadataEdits` + `addMetadataEdit`) and updated the refactor engine (`planRename`, `planBatchRename`, `validateRename`, `applyWorkspaceEdit`) to validate/apply these operations directly.
- Completed Phase 3:
  - Replaced broad `{ path: string }` traversal in `src/semantic/src/project-index/resource-analysis.ts` with schema-aware key extraction from `src/semantic/src/project-index/resource-reference-extractor.ts`.
  - Kept the output contract unchanged (`relationships.assetReferences`) while filtering to metadata targets (`.yy/.yyp`) and preserving project-manifest (`resources[].id`) coverage.
- Completed initial Phase 4 slice:
  - Updated `src/semantic/src/project-metadata/yy-adapter.ts` to derive known schema names directly from `Yy.schemas` instead of maintaining a duplicate hard-coded folder map.
  - Added schema-validation reporting (`schemaValidated`) in `parseProjectMetadataDocumentWithSchema` so callers can defer structural checks to `@bscotch/yy` while still using loose parse mode for compatibility.
  - Routed `src/semantic/src/project-index/resource-analysis.ts` through schema-aware adapter parsing and surfaced schema-mismatch warnings in diagnostic logs.
- Completed additional Phase 4 follow-up:
  - Fixed schema inference for absolute metadata paths (schema lookup now uses the resource parent directory instead of path-root assumptions), improving `@bscotch/yy` schema coverage in real project trees.
  - Added shared metadata path helpers in `src/semantic/src/project-metadata/yy-adapter.ts` (`getProjectMetadataValueAtPath`, `updateProjectMetadataReferenceByPath`) and switched both `src/semantic/src/identifier-case/asset-rename-executor.ts` and `src/cli/src/modules/refactor/semantic-bridge.ts` to use them, removing duplicate custom path traversal/mutation logic.
  - Expanded `.yyp` project reference extraction in `src/semantic/src/project-index/resource-reference-extractor.ts` to include folder/order/config-style manifest paths (`RoomOrderNodes[].roomId`, `Folders[].folderPath`, `Options[].path`) in addition to `resources[].id`.
- Completed additional Phase 4 follow-up (schema-native parse/stringify delegation):
  - Updated `src/semantic/src/project-metadata/yy-adapter.ts` so schema-aware parsing now delegates directly to `Yy.parse(raw, schemaName)` and falls back to loose parsing only when schema validation fails.
  - Updated metadata stringification to infer schema from document/path and call `Yy.stringify(document, schemaName)` when possible, improving serializer consistency with Stitch defaults.
  - Routed metadata rewrite callers (`src/semantic/src/identifier-case/asset-rename-executor.ts`, `src/cli/src/modules/refactor/semantic-bridge.ts`) through the schema-aware adapter path so rename/refactor operations delegate more responsibility to `@bscotch/yy`.
- Completed additional Phase 4 follow-up (project-manifest metadata rewrites):
  - Updated `src/cli/src/modules/refactor/semantic-bridge.ts` so metadata rewrite planning now covers both resource metadata (`.yy`) and project manifests (`.yyp`) when applying rename-driven reference updates.
  - Tightened rename-time metadata mutation to patch targeted string literals in-place when possible, preserving untouched room/object numeric literals instead of reserializing whole documents for simple `name`/`path` updates.
  - Hardened metadata reference matching for case-only resource-path drift so repeated rename/codemod runs can realign `.yyp` entries with on-disk resource casing instead of leaving stale manifest paths behind.
  - Added manifest rewrite verification to `src/cli/test/gml-semantic-bridge.test.ts` to confirm `resources[].id` references are rewritten via the same schema-aware metadata pipeline.
- Completed additional Phase 4 follow-up (strict schema-gated mutation parsing):
  - Added `parseProjectMetadataDocumentForMutation` in `src/semantic/src/project-metadata/yy-adapter.ts`, which enforces inferred `@bscotch/yy` schema validation for rename/refactor mutation workflows and throws a dedicated schema-validation error on mismatch.
  - Switched metadata mutation entry points (`src/semantic/src/identifier-case/asset-rename-executor.ts`, `src/cli/src/modules/refactor/semantic-bridge.ts`) to the stricter adapter API so malformed `.yy/.yyp` documents are skipped/blocked instead of being rewritten from loose parses.
  - Expanded adapter tests in `src/semantic/test/project-metadata-yy-adapter.test.ts` to verify schema mismatch reporting and strict mutation guard behavior.
- Completed additional Phase 4 follow-up (file-level delegation to `@bscotch/yy`):
  - Added file I/O helpers in `src/semantic/src/project-metadata/yy-adapter.ts` (`readProjectMetadataDocumentFromFile`, `readProjectMetadataDocumentForMutationFromFile`, `writeProjectMetadataDocumentToFile`) so semantic metadata workflows can delegate parsing/serialization decisions to `Yy.readSync`/`Yy.writeSync`.
  - Updated `src/semantic/src/identifier-case/asset-rename-executor.ts` to route default filesystem metadata writes through `writeProjectMetadataDocumentToFile`, preserving mocked `fsFacade` behavior in tests while using Stitch-native write semantics in production flows.
  - Updated `src/cli/src/modules/refactor/semantic-bridge.ts` to parse mutation metadata via `readProjectMetadataDocumentForMutationFromFile`, so bridge planning uses the same schema-gated file parsing policy as semantic rename execution.
  - Expanded `src/semantic/test/project-metadata-yy-adapter.test.ts` with file-level read/write coverage, including `Yy.writeSync` no-op detection on unchanged metadata writes.
- Added focused tests:
  - `src/semantic/test/project-metadata-yy-adapter.test.ts`
  - `src/semantic/test/project-index-resource-analysis.test.ts`
  - Updated parse-failure expectations in `src/semantic/test/identifier-case-asset-rename-executor.test.ts`
  - Added bridge test coverage for metadata edit operations in `src/cli/test/gml-semantic-bridge.test.ts`
  - Added refactor-engine coverage for metadata-only validation/apply paths in `src/refactor/test/index.test.ts`

### Remaining work to fully realize the plan
1. Continue reducing duplicate metadata parsing utilities by deprecating remaining `.yy/.yyp` paths that still rely on generic JSON helpers outside the semantic adapter.
2. Evaluate optional `Yy.schemas` strict-parse gates in adapter workflows where format stability is guaranteed (to avoid over-normalizing unknown/new fields); schema-validation reporting is now available, but strict enforcement policies are still pending.

### Validation + audit update (2026-02-07)
- Verified required gates:
  - `pnpm run build:ts` ✅
  - `pnpm run lint:quiet` ✅
- Confirmed `.yy/.yyp` production code paths now route through the semantic `@bscotch/yy` adapter (`src/semantic/src/project-metadata/yy-adapter.ts`) and no remaining semantic/cli/refactor metadata mutation flow is using `Core.parseGameMakerJson`, `Core.parseJsonWithContext`, or `Core.stringifyJsonForFile`.
- Confirmed remaining `Core.parseJsonWithContext` usages in semantic are non-GameMaker metadata contexts only (built-in identifier metadata + project-index cache), so they are not duplicate `.yy/.yyp` implementations.
- Executed targeted runtime verification:
  - `pnpm run test:semantic` ❌ (2 existing failures in dry-run reporting assertions: `src/semantic/dist/test/identifier-case-locals.integration.test.js`, `src/semantic/dist/test/identifier-case-report.test.js`; not in yy-adapter mutation paths)
  - `pnpm run test:refactor` / `pnpm run test:cli` were not executed after semantic test failure short-circuited the chained command.

### Expected wins
- Stable `.yy/.yyp` round-tripping with less GameMaker-induced diff churn.
- Fewer false positives and fewer corrupted metadata edits during rename/refactor.
- Consistent metadata behavior across semantic indexing, identifier-case asset renames, and CLI refactor operations.

### Risks and mitigations
- Risk: schema/version mismatches for newer GameMaker metadata variants.
  - Mitigation: adapter falls back to loose parse mode where needed, with explicit diagnostics and test fixtures.
- Risk: large migration touching semantic + refactor integration points.
  - Mitigation: keep output contracts unchanged and migrate in phases with compatibility tests per phase.
- Risk: operation ordering between metadata writes and file renames.
  - Mitigation: preserve current ordering contract (write updates first, then rename files/directories) and assert preconditions.

## References
- `https://github.com/bscotch/stitch/tree/develop/packages/parser`
- `packages/parser/src/project.ts`
- `packages/parser/src/project.asset.ts`
- `packages/parser/src/project.code.ts`
- `packages/parser/src/lexer.ts`, `packages/parser/src/parser.ts`
- `packages/parser/gml-cst.d.ts`
- `src/parser/src/gml-parser.ts`
- `docs/target-state.md`
- `src/semantic`
- `https://github.com/bscotch/stitch/tree/develop/packages/launcher`
- `packages/launcher/src/lib/GameMakerLauncher.ts`
- `packages/launcher/src/lib/GameMakerIde.ts`
- `packages/launcher/src/lib/GameMakerRuntime.ts`
- `packages/launcher/src/lib/GameMakerRuntime.command.ts`
- `packages/launcher/src/lib/GameMakerComponent.ts`
- `packages/launcher/src/lib/utility.ts`
- `https://github.com/bscotch/stitch/tree/develop/packages/yy`
- `packages/yy/src/Yy.ts`
- `packages/yy/src/Yy.parse.ts`
- `packages/yy/src/Yy.stringify.ts`
- `src/semantic/src/identifier-case/asset-rename-executor.ts`
- `src/semantic/src/identifier-case/asset-renames/planner.ts`
- `src/semantic/src/project-index/resource-analysis.ts`
- `src/cli/src/modules/refactor/semantic-bridge.ts`
- `src/refactor/src/refactor-engine.ts`
