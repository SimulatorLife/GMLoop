# Plan: Automating Feather lint metadata ingestion

## Goals and scope
- Mirror the approach used for `gml-identifiers.json` by scraping first-party GameMaker sources instead of maintaining hand-written lint metadata.
- Capture the rules that affect formatter output: message catalogue (GM* diagnostics), naming-style presets, suppress/override directives, and Feather's type taxonomy.
- Produce a machine-readable artefact (stored as `resources/feather-metadata.json`) that can be regenerated against any GameMaker release tag and consumed by future formatting heuristics.

## Current implementation
- [`src/cli/src/commands/generate-feather-metadata.ts`](../src/cli/src/commands/generate-feather-metadata.ts) implements the scraper and defaults to writing `resources/feather-metadata.json`, keeping the generated dataset beside the identifier snapshot for easy consumption. All tooling now lives under the CLI—do not add stand-alone scripts when expanding the pipeline.
- Manual content now lives in the `vendor/GameMaker-Manual` git submodule, eliminating bespoke GitHub downloads and caches. When iterating on unpublished builds, pass `--manual-root` to point at an alternate snapshot or `--manual-package` to fall back to an npm registry package installed via `pnpm add` if needed.
- The CLI surface is intentionally small: `--output` selects the destination file (defaulting to `resources/feather-metadata.json`), the manual source flags above control the asset location, and `--quiet` suppresses status logging for CI and scripted runs.

## Upstream sources worth harvesting
1. **GameMaker Manual (YoYoGames/GameMaker-Manual)**
   - The manual repository already exposes multiple Feather-specific HTML topics: `Feather_Messages`, `Feather_Directives`, `Feather_Features`, `Feather_Data_Types`, and the IDE preference page that enumerates naming-rule controls.【6f027d†L1-L10】
   - `Feather_Messages` documents every GM1xxx/GM2xxx diagnostic with prose, fix guidance, and embedded code samples that we can parse into a structured rule catalogue.【3062ec†L1-L80】【f622c5†L1-L33】
   - `Feather_Settings` lists the configurable naming styles, prefixes/suffixes, and the linkage to GM2017, which is exactly the data we need to mirror Feather's naming policies.【702cf8†L31-L120】
   - `Feather_Directives` explains project-level overrides (`// Feather ignore …`, `// Feather use …`) including path glob syntax, so we can understand how to map diagnostics to suppressions and profiles.【40be1b†L1-L44】
   - `Feather_Data_Types` details the base types, specifiers, and collection syntax recognised by the language server, which we can lift to inform formatter-aware type hints later.【ec129e†L1-L80】
2. **Existing identifier harvesting command**
- [`src/cli/src/commands/generate-gml-identifiers.ts`](../src/cli/src/commands/generate-gml-identifiers.ts) shares the same manual source resolver, so both artefact generators operate against the installed package or any explicit manual root supplied by the caller.

## Extraction pipeline outline
1. **Version selection & sourcing**
- Pin the target manual revision via the `vendor/GameMaker-Manual` submodule. Local development can temporarily override the root by passing `--manual-root <path>` when experimenting with unpacked archives, and CI can rely on the checked-in submodule pointer for reproducibility.
2. **Data acquisition**
- Read the Feather HTML topics listed above straight from the submodule (or the override root) so regeneration remains a pure filesystem operation.【6f027d†L1-L10】
   - Keep the fetch list configurable so we can add/remove topics without touching code (e.g. JSON manifest describing each page and the section(s) to extract).
3. **HTML parsing**
   - Use a resilient HTML parser (Cheerio or `linkedom`) to traverse headings, paragraphs, tables, and code blocks. RoboHelp exports are consistent (nested `<h3>`, `<p class="code">`, `<table>` blocks), so we can map DOM structures to structured records.
   - For `Feather_Messages`, group each `<h3>` diagnostic heading with subsequent prose, notes, and code samples until the next heading. Extract the rule ID, title, description, strict-mode annotations (`div[data-conref]`), and sample snippets. Preserve HTML-to-Markdown conversion so we can surface examples later.【3062ec†L1-L80】【f622c5†L1-L33】
   - For `Feather_Settings`, parse the Naming Rules section to enumerate selectable styles, prefix/suffix toggles, and the GM2017 dependency. This can become a schema like `{ identifierKind, namingStyleOptions, supportsPrefix, supportsSuffix, preserveUnderscores }` for downstream formatters.【702cf8†L71-L120】
   - For `Feather_Directives`, capture directive keywords (`ignore`, `use`), valid scope patterns, and documented examples so we can validate suppression comments and propose quick fixes.【40be1b†L1-L44】
   - For `Feather_Data_Types`, extract the base type list, specifier examples, and explanatory text so we can normalise Feather type annotations when generating documentation or enforcing formatter-aware heuristics.【ec129e†L1-L80】
4. **Normalisation & schema**
      - Define a JSON schema that groups diagnostics under `{ id, title, defaultSeverity?, description, notes[], examples[], strictModeOnly }`. Severity is not spelled out in the HTML, so leave it optional for now and plan a follow-up investigation into IDE config files once we locate them.
      - Emit separate top-level sections for `diagnostics`, `namingRules`, `directives`, and `types`. Include metadata (`manualRoot`, `packageName`, `packageVersion`, `generatedAt`) that records the repository-relative manual root so snapshots do not embed machine-specific absolute paths.
5. **Tooling integration**
  - Expose a dedicated CLI entry point in `src/cli/src/commands/generate-feather-metadata.ts`, sharing ergonomics with the identifier generator and wiring it into `pnpm run build:feather-metadata` for easy regeneration and CI checks. Document the regeneration workflow alongside the identifier snapshot instructions in the [README](../README.md#regenerate-metadata-snapshots).
  - Write smoke tests that parse the generated JSON and assert that key sentinel rules (e.g. GM2017 naming rule) are present, flagging upstream changes early.

## Regeneration helper
- Run `pnpm run build:feather-metadata` to load the Feather topics from `vendor/GameMaker-Manual` and write them to `resources/feather-metadata.json`.
- Update the submodule to the desired revision (for example, `git submodule update --remote vendor/GameMaker-Manual`) or pass `--manual-root <path>` when working against a local unpacked build. If you prefer to source from the npm registry instead, install the package via `pnpm add` and pass `--manual-package <name>`.
- See the [README regeneration guide](../README.md#regenerate-metadata-snapshots) for a condensed workflow and related tooling entry points.

## Open questions / future research
- The manual does not expose rule severity presets. We should inspect GameMaker IDE distributions (potentially via `@bscotch/stitch-launcher`) for config files that mirror the Message Severity table shown in the UI, so we can enrich the dataset in a later iteration.
- Investigate whether Feather ships additional machine-readable metadata (e.g. language server protocol definitions) that could be scraped once we have access to an IDE install; the current plan focuses on publicly accessible manual content to unblock formatter research quickly.
