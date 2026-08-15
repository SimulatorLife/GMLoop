# Refactor Engine Module

This package powers GML-native codemods and semantic refactoring transactions, as outlined in the [target-state architecture plan](../../docs/target-state.md). It implements a native, GML-centric Collection API (inspired by `jscodeshift`) to handle atomic cross-file edits, metadata updates (`.yy`, `.yyp`), and structural migrations.

## Ownership Boundaries

`@gmloop/refactor` is the owner of **Global Transactions (Codemods)**.

- Depends on `@gmloop/semantic` for symbol/scope analysis inputs.
- Owns atomic cross-file edits, metadata updates, and structural migrations.
- Implements a jscodeshift-like Collection API for GML ASTs.
- Is the ONLY layer that should decide whether a rename requires cross-file edits or metadata changes.
- **Codemod/fixer commands are responsible for repairing non-parsable source text to restore parsability.**

It does not replace lint or formatter domains:

- `@gmloop/lint` owns **Diagnostic Reporting** and **Local Repairs** (single-file fixes). **Lint rule autofixes are responsible for fixing valid-but-forbidden syntax (e.g., style violations or deprecated patterns that are still syntactically valid).**
- `@gmloop/format` is **Formatter-only** (layout/canonical rendering) and does not own refactor transactions. **The formatter never repairs invalid syntax and only formats valid AST.**
- `@gmloop/cli` is the composition root that invokes refactor workflows through the `refactor` command.

## Responsibilities

- Query parser span data and semantic bindings to map identifiers to source ranges.
- Plan edits that avoid scope capture or shadowing, and surface validation diagnostics.
- Offer composable helpers so CLI commands can trigger explicit refactor transactions.
- Re-run targeted analysis after edits to ensure symbol bindings remain stable.
- Support batch rename operations for refactoring related symbols atomically.
- Provide detailed impact analysis for dry-run scenarios.
- Validate hot reload compatibility to ensure refactored code can be patched live.

## Features

- Naming-convention codemods treat unique constructor static members as cross-file rename targets, including dotted calls like `value.Sub()` and bare calls like `Reset()` that occur inside constructors or `with (...)` blocks.
- Batch resource renames compose staged metadata rewrites and staged file moves, so later renames in the same run resolve the current folder/file path even for non-canonical GameMaker layouts that keep multiple object `.yy` files in one directory.

## Performance Regression Coverage

Current guardrails focus on the two hottest naming-convention paths that showed up in profiling:

- Selected-path filtering now compiles allow/deny lists once per codemod run instead of re-resolving them for every candidate.
- `WorkspaceEdit` application now assembles rewritten file content in a single pass, avoiding one full-string allocation per text edit.
- Top-level naming-convention batch planning now reuses the first batch validation when the rename set is unchanged, avoiding a second full pass through `validateRenameRequest`.
- CLI local-variable naming scans now build each file's local-reference index once and reuse it for every declaration in that file.
- CLI semantic bridge lookups for script-backed callable declarations now use a resource-path index instead of rescanning every script entry for each lookup.
- Naming-convention planning now skips macro-expansion dependency scans for batches that only touch top-level/resource symbols, instead of parsing macro sources on every run whether local renames are present or not.
- Resource rename metadata planning now indexes inbound metadata references once per semantic bridge and reuses parsed `.yy/.yyp` documents across the batch instead of rescanning and reparsing them for every rename.
- `WorkspaceEdit` now caches grouped text edits per revision and tracks telemetry counters incrementally, avoiding extra full-edit scans in large codemod batches.
- The CLI refactor command now uses the semantic workspace's default GML project-index concurrency instead of forcing a serial build, so large codemod runs do not bottleneck on one-file-at-a-time indexing.
- Globalvar and loop-length codemod executions now reuse source text captured during planning when applying a workspace edit, eliminating redundant per-file reads in dry-run and write modes.
- Semantic query caches now use least-recently-used eviction so hot symbol/file lookups survive cache pressure during large codemod batches.

The refactor workspace keeps naming-convention codemod stress tests in the regular TypeScript test suite:

- [`src/refactor/test/naming-convention-performance.test.ts`](test/naming-convention-performance.test.ts) exercises high-volume local rename planning and edit application.
- [`src/cli/test/refactor-codemod-performance.test.ts`](../cli/test/refactor-codemod-performance.test.ts) exercises the indexed CLI bridge path for large top-level rename batches.
- [`src/cli/test/refactor-codemod-command-performance.test.ts`](../cli/test/refactor-codemod-command-performance.test.ts) exercises end-to-end `refactor codemod --write` execution on a larger synthetic GameMaker project so CLI indexing, planning, and write-back stay bounded.
- [`src/cli/test/refactor-naming-target-discovery-performance.test.ts`](../cli/test/refactor-naming-target-discovery-performance.test.ts) exercises naming-target discovery on mixed declaration/reference workloads so reference-only files do not rebuild local-reference indexes unnecessarily.
- [`src/cli/test/refactor-local-naming-performance.test.ts`](../cli/test/refactor-local-naming-performance.test.ts) exercises disk-backed local-variable codemods so CI catches regressions in source-text loading, local-occurrence indexing, and member-access filtering on real files.
- [`src/cli/test/refactor-script-resource-naming-performance.test.ts`](../cli/test/refactor-script-resource-naming-performance.test.ts) exercises script-backed function naming on large resource sets so repeated script-resource scans stay bounded.
- [`src/cli/test/refactor-metadata-resource-naming-performance.test.ts`](../cli/test/refactor-metadata-resource-naming-performance.test.ts) exercises metadata-backed script resource renames on disk so repeated manifest/resource metadata parsing stays bounded.

Use `pnpm run test:performance` to execute only the performance suite locally.

## Basic Usage

The `RefactorEngine` is initialized with a parser, a formatter, and a semantic analyzer interface. It orchestrates single-file and project-wide transactions (such as codemods and renames) using the `WorkspaceEdit` transaction container.

```typescript
import { RefactorEngine } from "@gmloop/refactor";

const engine = new RefactorEngine({ parser, semantic, formatter });

// Plan and apply a rename transaction
const result = await engine.executeRename({
    symbolId: "gml/script/scr_old_name",
    newName: "scr_new_name",
    readFile: async (path) => fs.promises.readFile(path, "utf8"),
    writeFile: async (path, content) => fs.promises.writeFile(path, content)
});
```

For complete, compile-safe examples of how to query, validate, and execute complex refactoring scenarios (including batch renames, validation pre-flight checks, structural safety analyses, and hot reload compatibility checks), refer to the test suites in [test/](test/).


### Naming Convention Enforcement (Policy Config)

Naming policy lives under `refactor.codemods.namingConvention` inside the unified
project-root `gmloop.json`. The `namingConvention` codemod reads that policy,
plans top-level renames through the batch rename engine, merges those edits with
local single-file renames into one workspace edit, and runs hot-reload
validation before apply.
Unsafe top-level renames are skipped with warnings so one conflicting symbol
does not abort the rest of the codemod run. Batch-planned metadata rewrites are
coalesced per metadata file so sequential resource renames compose into a
single `.yy`/`.yyp` update instead of conflicting duplicate rewrites, and write
mode avoids stale rename offsets by applying the merged workspace atomically.
Case-style rewrites preserve allowed leading and trailing underscore affixes, so
`lower_snake` policy does not silently strip names like `__input_error` unless
the policy explicitly bans those affixes. Conflict checking and reserved keyword
validation are case-sensitive because GameMaker Language is case-sensitive, so
renaming custom identifiers to target names that differ in casing from reserved
keywords or existing variables (e.g. custom macro `LERP` vs built-in `lerp`,
or same-scope `myVar` vs `MY_VAR`) is fully permitted and does not trigger conflicts.
Object-event assignment-backed fields
that the semantic index only reports as unresolved references are still treated
as instance-variable naming targets when they are introduced through instance
assignments, so project-wide variable policy can rename identifiers like
`charMat` to `char_mat`. Script resource names stay coupled to a same-name
top-level callable only when that file defines exactly one top-level callable;
multi-function script files expose the resource and each callable as
independent rename targets so policies can rename `DemoLibrary` and
`function DemoLibrary()` differently when needed, with resource renames
limited to metadata/path edits while callable renames own the text
occurrences inside `.gml` files.
A script resource is also exempt from `scriptResourceName` renaming when its
file defines exactly one struct/constructor declaration that already shares
the resource's name and independently complies with the declaration's own
naming rule (for example `LinkedHashMap.gml` defining
`function LinkedHashMap() constructor {}`), so struct-backed script files can
use the struct name instead of the standard script prefix without a
project-wide naming exemption.
Constructor renames also update parent-constructor clauses such as
`function Child() : BaseType() constructor {}`, and local naming rewrites skip
identifiers that referenced `#macro` expansions read from the caller scope so
the refactor output remains valid after GameMaker preprocesses macro bodies.
Cross-file enum and macro renames also collect unresolved top-level consumer
references from project file records so naming-convention runs keep
`CM_RAY.MASK`-style uses aligned with renamed declarations.
Within multi-callable script resources, each callable now keeps its own
declaration category: constructor or struct policies only affect the matching
declarations, and plain functions stay untouched unless the policy explicitly
configures the `function` category.

#### Contract

- `gmloop.json` is the project config file.
- `refactor.codemods.namingConvention` is user-authored project config.
- `refactor.codemods.namingConvention` enables the codemod.
- `rule exists => enabled` is the contract.
- There is no `enabled` property on naming rules. If a rule is present for a category, that category is enabled. If a category is set to `false`, it is disabled even if a parent has a rule.

#### Project Config Shape

```json
{
    "printWidth": 95,
    "lintRules": {
        "gml/no-globalvar": "error"
    },
    "refactor": {
        "codemods": {
            "namingConvention": {
                "rules": {
                    "resource": {
                        "caseStyle": "lower"
                    },
                    "roomResourceName": {
                        "prefix": "rm_"
                    },
                    "variable": {
                        "caseStyle": "camel"
                    },
                    "globalVariable": {
                        "prefix": "g_",
                        "caseStyle": "lower_snake"
                    },
                    "loopIndexVariable": false,
                    "callable": {
                        "caseStyle": "camel"
                    },
                    "macro": {
                        "caseStyle": "upper_snake"
                    }
                },
                "exclusivePrefixes": {
                    "rm_": "roomResourceName"
                }
            },
            "scientificNotation": {}
        }
    }
}
```

The `repairTexturePrefetchGuard` codemod repairs a common HTML5 portability
error: it changes a `texture_is_ready(texture)` guard that immediately calls
`texture_prefetch(texture)` to prefetch only when the texture is not ready. It
is conservative around user-defined declarations and macros, and can be
enabled alongside the other configured codemods:

```json
{
    "refactor": {
        "codemods": {
            "repairTexturePrefetchGuard": {}
        }
    }
}
```

The `repairInvalidTexturePointerGuard` codemod repairs the corresponding
startup failure when a project throws on an invalid texture pointer even
though the function already declares a texture-info fallback struct. It
returns that fallback from the structurally matched guard and leaves guards
without a declared fallback untouched:

```json
{
    "refactor": {
        "codemods": {
            "repairInvalidTexturePointerGuard": {}
        }
    }
}
```

The `repairAudioEmitterCreationGuard` codemod guards zero-argument
`audio_emitter_create()` calls with `audio_system_is_initialised()` so an
HTML5 build cannot retain a partially initialized emitter during startup:

```json
{
    "refactor": {
        "codemods": {
            "repairAudioEmitterCreationGuard": {}
        }
    }
}
```

The `repairSpriteTextureUvResolution` codemod repairs helpers that test
`scr_texture_is_valid(sprite)` before `scr_sprite_exists(sprite)`. Native
GameMaker keeps those asset kinds distinct, but HTML5 represents sprite
references numerically, so the texture branch can otherwise dereference a
sprite asset as a texture page. The codemod swaps only the matching branches
inside a `scr_get_uvs` helper and preserves its fallback branch:

```json
{
    "refactor": {
        "codemods": {
            "repairSpriteTextureUvResolution": {}
        }
    }
}
```

#### CLI Usage

```bash
# Preview configured codemods and effective config
pnpm run cli -- refactor codemod --list

# Dry-run configured codemods for the whole project
pnpm run cli -- refactor codemod

# Apply only namingConvention to a subset of paths
pnpm run cli -- refactor codemod scripts/player --only namingConvention --write
```

Selected-path namingConvention runs now resolve naming targets with one
filtered semantic query for the whole file set instead of rescanning the full
project index once per file. The refactor test suite includes a tracked
stress test for this path, so the existing `pnpm run test:refactor` and
`pnpm run test:report` jobs catch regressions in both behavior and runtime.
Naming-target discovery now also preserves the semantic provider method context
(`this`) when invoking `listNamingConventionTargets`, so bridge-backed
project-root resolution keeps working during batched resource rename queries.
The CLI semantic bridge also keeps indexed name and symbol-id lookup tables for
rename validation, occurrence gathering, and scope checks, preventing large
codemod runs from repeatedly scanning every identifier collection for every
top-level rename candidate.

Unresolved project-file references are also indexed once per bridge session and
reused during rename occurrence gathering instead of being rescanned across the
full file map for every symbol. Batch rename planning now keeps the refactor
semantic query cache warm while metadata overlays are staged, so later renames
in the same codemod run can reuse symbol existence and occurrence lookups.
When a resource rename still needs disk-backed fallback occurrence discovery,
the CLI semantic bridge now builds one cached identifier-occurrence index per
GML file and reuses it across the whole codemod session instead of reparsing or
rescanning every file for every renamed resource.

Naming-convention edits also normalize semantic occurrence spans to exclusive
end indexes before generating workspace edits, and local-variable rename
targets explicitly exclude property/member access tokens (for example
`enum_name.Member`) so codemods do not corrupt valid member accesses when a
local identifier happens to share the same spelling.

#### Policy Shape

```ts
type NamingCaseStyle =
    | "lower"
    | "upper"
    | "camel"
    | "lower_snake"
    | "upper_snake"
    | "pascal";

type NamingCategory =
    | "resource"
    | "scriptResourceName"
    | "objectResourceName"
    | "roomResourceName"
    | "spriteResourceName"
    | "audioResourceName"
    | "timelineResourceName"
    | "shaderResourceName"
    | "fontResourceName"
    | "pathResourceName"
    | "sequenceResourceName"
    | "tilesetResourceName"
    | "variable"
    | "localVariable"
    | "globalVariable"
    | "instanceVariable"
    | "staticVariable"
    | "argument"
    | "catchArgument"
    | "loopIndexVariable"
    | "callable"
    | "function"
    | "constructorFunction"
    | "typeName"
    | "structDeclaration"
    | "enum"
    | "member"
    | "enumMember"
    | "macro";

type NamingRuleConfig = {
    caseStyle?: NamingCaseStyle;
    prefix?: string;
    suffix?: string;
    minChars?: number;
    maxChars?: number;
    bannedPrefixes?: string[];
    bannedSuffixes?: string[];
};

type NamingConventionPolicy = {
    rules: Partial<Record<NamingCategory, NamingRuleConfig | false>>;
    exclusivePrefixes?: Record<string, NamingCategory>;
    exclusiveSuffixes?: Record<string, NamingCategory>;
};

type ResolvedNamingRule = {
    prefix: string;
    suffix: string;
    caseStyle: NamingCaseStyle;
    minChars: number | null;
    maxChars: number | null;
    bannedPrefixes: readonly string[];
    bannedSuffixes: readonly string[];
};

type ResolvedNamingConventionRules = Partial<
    Record<NamingCategory, ResolvedNamingRule>
>;
```

#### Built-In Category Hierarchy

The parent structure is built into the engine and does not need to be declared
in user config:

```ts
const NAMING_CATEGORY_PARENTS: Record<NamingCategory, NamingCategory | null> = {
    resource: null,
    scriptResourceName: "resource",
    objectResourceName: "resource",
    roomResourceName: "resource",
    spriteResourceName: "resource",
    audioResourceName: "resource",
    timelineResourceName: "resource",
    shaderResourceName: "resource",
    fontResourceName: "resource",
    pathResourceName: "resource",
    sequenceResourceName: "resource",
    tilesetResourceName: "resource",

    variable: null,
    localVariable: "variable",
    globalVariable: "variable",
    instanceVariable: "variable",
    staticVariable: "variable",
    argument: "variable",
    catchArgument: "variable",
    loopIndexVariable: "localVariable",

    callable: null,
    function: "callable",

    typeName: null,
    structDeclaration: "typeName",
    constructorFunction: "structDeclaration",
    enum: "typeName",

    member: null,
    enumMember: "member",

    macro: null
};
```

#### Enforcement Model

- Identify each symbol's category key from semantic data (for example `roomResourceName`, `function`, `localVariable`).
- Resolve each category using the built-in parent map (root -> leaf merge).
- Apply only explicitly provided properties as overrides (`caseStyle`, `prefix`, `suffix`, `minChars`, `maxChars`, `bannedPrefixes`, `bannedSuffixes`).
- If a category is set to `false`, disable that category even if a parent has a rule.
- If no rule exists for a category after inheritance, that category is not enforced.
- Validate in this order: banned affixes -> exclusive affixes -> required prefix/suffix -> length (`minChars`/`maxChars`) -> case style (on the core name after removing required prefix/suffix).
- Emit diagnostics for violations and provide refactor-driven rename plans to fix them.
- Run existing rename conflict checks before applying any generated rename transaction.

#### Notes

- Current runtime target coverage includes resource names, script/constructor/struct declarations, enums, enum members, macros, globals, instance variables, locals, static locals, loop indices, arguments, and catch arguments.
- Naming-convention planning expands selected `.gml` paths to their owning resource `.yy` files, so object event rewrites also execute the matching object resource rename transaction instead of leaving code and metadata out of sync.
- Implicit instance-variable coverage follows unresolved object-event assignments across related object event files, including inherited child-object reads and dotted object-property reads, while excluding known enum-owner member accesses such as `CM.R` so enum members are not folded into instance-variable renames.
- `staticVariable` and `loopIndexVariable` are syntax-refined local-variable categories. The refactor engine only exposes concrete categories that it can currently rename with complete occurrence coverage from the semantic bridge.
- Prefix/suffix matching is strict and case-sensitive.
- Parent/category relationships are not stored in `ResolvedNamingRule`; they are only used during rule resolution.
- `lower_snake` and `upper_snake` are both supported to enforce snake-case in either casing.
- `exclusivePrefixes` and `exclusiveSuffixes` are global reservations that apply even when a category has no required prefix/suffix.
- If exclusive affixes overlap, use longest-match precedence to avoid ambiguous ownership.
- Resource naming-prefix enforcement replaces detectable legacy short prefixes when possible instead of duplicating them (for example `oSpider` -> `obj_spider`, `sSpiderHead` -> `spr_spider_head`).
- `minChars` and `maxChars` are checked against the core name after removing required prefix/suffix.
- Cache resolved rules by category key so validation and rename previews stay fast.
- This policy remains centralized so IDE/CLI integrations enforce the same naming behavior.

##### Refactoring Features

#### Rename Operations
Allows planning and executing rename refactorings for both single symbols and batches of related symbols atomically, ensuring all files and project metadata (`.yy`, `.yyp`) are updated in a single transaction.

#### Impact Analysis
Analyzes the potential impact of a rename before committing to it. It returns summaries of affected files, occurrence kinds (definitions vs. references), dependent symbols, and whether hot reload is required.

#### Hot Reload Safety Check & Validation
Checks if a rename is safe for live hot reloading (e.g., scripts and instance variables vs. macros and keywords) and validates that a planned set of workspace edits will not break hot reload constraints.

#### Occurrence & Scope Validation
Provides utilities to classify, filter, and group occurrences, and to perform efficient batch scope-shadowing validation across scopes.

## Performance Optimization

### Semantic Query Cache
The refactor engine supports session-scoped caching of semantic analyzer queries to optimize batch operations and impact analysis (e.g., mapping symbol occurrences, dependents, file symbols, and existence). The `SemanticQueryCache` class provides LRU/FIFO eviction policy with a configurable max capacity and TTL.

### Rename Validation Cache
A specialized cache for rename validation results. In interactive rename sessions (such as an IDE rename dialog), this caches structural, scope, and cross-file validation results to provide instant feedback as users type.


## Directory layout

- `src/` – core refactoring primitives and orchestrators.
- `test/` – Node tests that validate refactor strategies against fixture projects.

## API Reference

### RefactorEngine

Main class for coordinating refactoring operations.

**Constructor:**

```javascript
new RefactorEngine({ parser, semantic, formatter });
```

**Methods:**

#### Rename Operations

- `async validateRenameRequest(request, options)` - Validate a single rename request without creating edits (returns validation results instead of throwing)
- `async validateBatchRenameRequest(renames, options)` - Validate multiple rename requests before planning, detecting conflicts between renames
- `async planRename(request)` - Plan a single symbol rename
- `async planBatchRename(renames)` - Plan multiple renames atomically
- `async executeRename(request)` - Execute a rename with optional hot reload
- `async executeBatchRename(request)` - Execute multiple renames atomically

#### Analysis &amp; Validation

- `async analyzeRenameImpact(request)` - Analyze impact without applying changes
- `async validateRename(workspace)` - Validate a workspace edit
- `async validateHotReloadCompatibility(workspace, options)` - Check hot reload compatibility
- `async checkHotReloadSafety(request)` - Check if a rename is safe for hot reload
- `async verifyPostEditIntegrity(request)` - Verify semantic integrity after applying edits

#### Workspace Operations

- `async applyWorkspaceEdit(workspace, options)` - Apply edits to files (`includeResultContent: false` avoids retaining full post-edit text in memory during write flows)
- `async prepareRenamePlan(request, options)` - Prepare a comprehensive rename plan with validation
- `async prepareBatchRenamePlan(renames, options)` - Prepare a comprehensive batch rename plan with validation, optional impact analysis (`includeImpactAnalyses`), and optional hot reload metadata

#### Hot Reload Integration

- `async prepareHotReloadUpdates(workspace)` - Prepare hot reload update metadata
- `async generateTranspilerPatches(hotReloadUpdates, readFile)` - Generate transpiled patches
- `async computeHotReloadCascade(changedSymbolIds)` - Compute transitive dependency closure for hot reload
- `async computeRenameImpactGraph(symbolId)` - Compute detailed dependency impact graph with critical path analysis

#### Symbol Queries

- `async findSymbolAtLocation(filePath, offset)` - Find symbol at position
- `async validateSymbolExists(symbolId)` - Check if symbol exists
- `async gatherSymbolOccurrences(symbolName)` - Get all occurrences of a symbol
- `async getFileSymbols(filePath)` - Query symbols defined in a specific file
- `async getSymbolDependents(symbolIds)` - Query symbols that depend on given symbols

#### Conflict Detection

- `async detectRenameConflicts(request)` - Detect conflicts for a proposed rename operation without throwing errors

### Validation Functions

Standalone utilities for validating rename requests:

- `async validateRenameStructure(symbolId, newName, resolver)` - Fast structural validation of rename parameters before planning
    - Validates parameter presence, identifier syntax, and optional symbol existence
    - Returns array of error messages (empty if valid)
    - Enables fail-fast pattern without expensive occurrence gathering
- `detectCircularRenames(renames)` - Detect circular rename chains in batch operations
    - Returns first detected cycle as array of symbol IDs (empty if no cycles)
- `async batchValidateScopeConflicts(occurrences, newName, resolver)` - Efficiently validate scope safety across multiple occurrences
    - Groups occurrences by scope to minimize redundant lookups
    - Returns map of scope IDs to conflict information
    - Essential for hot reload scenarios where many symbols need validation quickly
    - Reduces validation overhead by checking each unique scope only once
- `async validateCrossFileConsistency(symbolId, newName, occurrences, fileProvider)` - Validate cross-file semantic consistency for renames
    - Checks whether renaming would create ambiguous references across files
    - Detects file-level symbol conflicts where new name already exists
    - Warns about large rename operations (>20 occurrences per file)
    - Essential for multi-file refactorings and ensuring import/export consistency
    - Returns array of conflict entries with file paths and severity levels

### Occurrence Analysis Functions

Standalone utilities for analyzing symbol occurrences:

- `classifyOccurrences(occurrences)` - Classify occurrences into categories (definitions, references, by file, by kind)
- `filterOccurrencesByKind(occurrences, kinds)` - Filter occurrences by kind (e.g., ["definition"], ["reference"])
- `groupOccurrencesByFile(occurrences)` - Group occurrences by file path
- `findOccurrencesInFile(occurrences, filePath)` - Find occurrences within a specific file
- `countAffectedFiles(occurrences)` - Count unique files affected by occurrences

### Rename Preview Functions

Utilities for generating human-readable previews and reports of rename operations:

- `generateRenamePreview(workspace, oldName, newName)` - Generate a preview of changes that will be made by a workspace edit
- `formatRenamePlanReport(plan)` - Format a rename plan summary as a multi-line text report
- `formatBatchRenamePlanReport(plan)` - Format a batch rename plan summary as a multi-line text report
- `formatOccurrencePreview(occurrences, oldName, newName)` - Format occurrence locations as a diff-style preview

These functions are essential for:

- IDE integrations that need to show diff-like previews before applying renames
- CLI tools that want to present detailed impact reports to users
- Automated refactoring pipelines that need to log changes before applying them
- Debugging refactoring operations by visualizing what will change

### Hot Reload Functions

Standalone utilities for hot reload coordination and analysis:

- `computeHotReloadCascade(changedSymbolIds, semantic)` - Compute transitive dependency closure for hot reload
- `checkHotReloadSafety(request, semantic)` - Check if a rename is safe for hot reload
- `prepareHotReloadUpdates(workspace, semantic)` - Prepare hot reload update metadata from workspace edit
- `generateTranspilerPatches(hotReloadUpdates, readFile, formatter)` - Generate transpiled patches from hot reload updates
- `computeRenameImpactGraph(symbolId, semantic)` - Compute detailed dependency impact graph with critical path analysis

The `computeRenameImpactGraph` function is particularly useful for:

- Visualizing the full scope of a rename's impact on the codebase
- Understanding dependency relationships and reload propagation
- Estimating hot reload timing and identifying performance bottlenecks
- Planning complex refactorings that affect multiple interconnected symbols
- Building interactive dependency visualization tools in IDEs


### WorkspaceEdit

Container for text edits across multiple files.

**Methods:**

- `addEdit(path, start, end, newText)` - Add a text edit
- `groupByFile()` - Group edits by file path (sorted for safe application)

### SemanticQueryCache

Caching layer for semantic analyzer queries during refactoring operations.

**Constructor:**

```javascript
new SemanticQueryCache(semantic, config);
```

**Configuration:**

- `maxSize` - Maximum entries per cache type (default: 100). A value of `0` keeps the cache enabled but gives it zero capacity, so results are returned without being retained.
- `ttlMs` - Time-to-live in milliseconds (default: 60000)
- `enabled` - Enable/disable caching (default: true)

**Methods:**

- `async getSymbolOccurrences(symbolName)` - Get cached symbol occurrences
- `async getFileSymbols(filePath)` - Get cached file symbols
- `async getDependents(symbolIds)` - Get cached dependent symbols
- `async hasSymbol(symbolId)` - Check cached symbol existence
- `invalidateAll()` - Clear all cached entries
- `invalidateFile(filePath)` - Clear entries for specific file
- `getStats()` - Get cache performance statistics
- `resetStats()` - Reset performance counters

**Statistics:**

- `hits` - Number of cache hits
- `misses` - Number of cache misses
- `evictions` - Number of entries evicted due to size limits
- `size` - Current total cache size across all types

### RenameValidationCache

Caching layer for rename validation results during interactive refactoring.

**Constructor:**

```javascript
new RenameValidationCache(config);
```

**Configuration:**

- `maxSize` - Maximum cached validation results (default: 50)
- `ttlMs` - Time-to-live in milliseconds (default: 30000)
- `enabled` - Enable/disable caching (default: true)

**Methods:**

- `async getOrCompute(symbolId, newName, compute)` - Get cached validation or compute new result
- `invalidate(symbolId, newName)` - Invalidate specific symbol-name pair
- `invalidateSymbol(symbolId)` - Invalidate all cached validations for a symbol
- `invalidateAll()` - Clear all cached validation results
- `getStats()` - Get cache performance statistics
- `resetStats()` - Reset performance counters

**Statistics:**

- `hits` - Number of cache hits
- `misses` - Number of cache misses
- `evictions` - Number of entries evicted due to size limits
- `size` - Current cache size

## Status

The refactor engine now includes comprehensive rename planning, batch operations, impact analysis,
hot reload validation, occurrence analysis utilities, rename preview and reporting utilities,
advanced dependency cascade computation, detailed rename impact graph visualization, semantic
query caching, and rename validation caching for performance optimization. It integrates with the
semantic analyzer to provide safe, scope-aware refactoring operations with full transitive
dependency tracking for hot reload scenarios. The impact graph computation provides critical path
analysis and timing estimates, enabling IDE integrations and CLI tools to present detailed,
human-readable reports of planned changes and their hot reload implications before applying them.
The query cache layer optimizes repeated semantic queries during batch operations, while the
validation cache layer speeds up interactive rename workflows by caching validation results as
users type new names, significantly improving performance for complex refactoring workflows and
providing instant feedback in IDE rename dialogs.

## TODO

- For the renaming fix, we should support an allow/deny list of prefixes, suffixes, and names that are exempt from renaming. For example, if a project's `gmploop.json` specifies that sprites must use the `spr_` prefix, the rename configuration should also allow exceptions such as sprites with the tex\_ prefix so they are not flagged for renaming.
- Alternatively, instead of requiring a specific prefix or suffix, we could support a denylist of disallowed names, prefixes, or suffixes. So, resources would only be flagged for renaming if they match an entry in the denylist. For example, if a resource is named `__apple` and the denylist includes the prefix `__`, it would be flagged for renaming, since it matches a disallowed naming pattern. In this mode, renaming would follow a default or separately defined naming rule (e.g., a standard prefix/suffix or pattern), applied only when a name violates the denylist. In this mode, a resource that matches the denylist would first check its inheritance tree and try to inherit a valid naming prefix from its parent chain. If no applicable prefix is found, it should attempt to remove the disallowed prefix, provided the result passes all safety checks. If that still fails, it should fall back to the default naming convention.
