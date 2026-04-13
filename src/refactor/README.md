# Refactor Engine Module

This package powers GML-native codemods and semantic refactoring transactions, as outlined in the [formatter/linter split plan](../../docs/formatter-linter-split-plan.md). It implements a native, GML-centric Collection API (inspired by `jscodeshift`) to handle atomic cross-file edits, metadata updates (`.yy`, `.yyp`), and structural migrations.

## Ownership Boundaries

`@gmloop/refactor` is the owner of **Global Transactions (Codemods)**.

- Depends on `@gmloop/semantic` for symbol/scope analysis inputs.
- Owns atomic cross-file edits, metadata updates, and structural migrations.
- Implements a jscodeshift-like Collection API for GML ASTs.
- Is the ONLY layer that should decide whether a rename requires cross-file edits or metadata changes.

It does not replace lint or formatter domains:

- `@gmloop/lint` owns **Diagnostic Reporting** and **Local Repairs** (single-file fixes).
- `@gmloop/format` is **Formatter-only** (layout/canonical rendering) and does not own refactor transactions.
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
- `WorkspaceEdit` now caches grouped text edits per revision and skips the second structural validation pass when the same immutable workspace is applied immediately after validation.
- The CLI refactor command now uses the semantic workspace's default GML project-index concurrency instead of forcing a serial build, so large codemod runs do not bottleneck on one-file-at-a-time indexing.
- Globalvar and loop-length codemod executions now reuse source text captured during planning when applying a workspace edit, eliminating redundant per-file reads in dry-run and write modes.
- Semantic query caches now use least-recently-used eviction so hot symbol/file lookups survive cache pressure during large codemod batches.

The refactor workspace keeps naming-convention codemod stress tests in the regular TypeScript test suite:

- [`src/refactor/test/naming-convention-performance.test.ts`](./test/naming-convention-performance.test.ts) exercises high-volume local rename planning and edit application.
- [`src/cli/test/refactor-codemod-performance.test.ts`](../cli/test/refactor-codemod-performance.test.ts) exercises the indexed CLI bridge path for large top-level rename batches.
- [`src/cli/test/refactor-codemod-command-performance.test.ts`](../cli/test/refactor-codemod-command-performance.test.ts) exercises end-to-end `refactor codemod --write` execution on a larger synthetic GameMaker project so CLI indexing, planning, and write-back stay bounded.
- [`src/cli/test/refactor-naming-target-discovery-performance.test.ts`](../cli/test/refactor-naming-target-discovery-performance.test.ts) exercises naming-target discovery on mixed declaration/reference workloads so reference-only files do not rebuild local-reference indexes unnecessarily.
- [`src/cli/test/refactor-local-naming-performance.test.ts`](../cli/test/refactor-local-naming-performance.test.ts) exercises disk-backed local-variable codemods so CI catches regressions in source-text loading, local-occurrence indexing, and member-access filtering on real files.
- [`src/cli/test/refactor-script-resource-naming-performance.test.ts`](../cli/test/refactor-script-resource-naming-performance.test.ts) exercises script-backed function naming on large resource sets so repeated script-resource scans stay bounded.
- [`src/cli/test/refactor-metadata-resource-naming-performance.test.ts`](../cli/test/refactor-metadata-resource-naming-performance.test.ts) exercises metadata-backed script resource renames on disk so repeated manifest/resource metadata parsing stays bounded.

Use `pnpm run test:performance` to execute only the compiled performance suite locally. CI also runs that script explicitly on the `head` leg in addition to the normal `pnpm run test:ci` coverage pass, so performance regressions stay visible even when the broader test matrix is green.

### Project-wide Codemod Execution

Run loop-length hoisting as a single transaction across multiple files through the refactor engine:

```javascript
const engine = new RefactorEngine({ semantic, parser, formatter });

const result = await engine.executeLoopLengthHoistingCodemod({
    filePaths: ["scripts/player_step.gml", "scripts/enemy_step.gml"],
    readFile: async (path) => await fs.promises.readFile(path, "utf8"),
    writeFile: async (path, content) =>
        await fs.promises.writeFile(path, content, "utf8")
});

console.log(result.changedFiles);
```

This keeps codemod execution project-aware and atomic by funneling all rewrites through a single `WorkspaceEdit` transaction.
When `dryRun: true`, `writeFile` is optional and no filesystem writes are performed.

### Rename Validation (Pre-flight Check)

Before planning a rename, validate the request to provide user-friendly feedback without throwing errors:

```javascript
const engine = new RefactorEngine({ semantic, parser, formatter });

// Validate rename request before committing to planning
const validation = await engine.validateRenameRequest({
    symbolId: "gml/script/scr_player",
    newName: "scr_hero"
});

if (!validation.valid) {
    console.error("Cannot rename:", validation.errors);
    // Display errors to user without stack traces
} else {
    console.log(`Found ${validation.occurrenceCount} occurrences to rename`);
    if (validation.warnings.length > 0) {
        console.warn("Warnings:", validation.warnings);
    }
    // Proceed with planRename()
}
```

This is especially useful for:

- IDE integrations that need to show inline validation errors
- CLI tools that want to provide friendly error messages before processing
- Dry-run scenarios where you want to check feasibility without side effects

### Batch Rename Validation (Pre-flight Check for Multiple Renames)

Validate multiple rename operations before planning edits, detecting conflicts between renames:

```javascript
const engine = new RefactorEngine({ semantic, parser, formatter });

// Validate batch rename request
const validation = await engine.validateBatchRenameRequest([
    { symbolId: "gml/script/scr_enemy_old", newName: "scr_enemy_new" },
    {
        symbolId: "gml/script/scr_enemy_helper_old",
        newName: "scr_enemy_helper_new"
    }
]);

if (!validation.valid) {
    console.error("Batch rename has errors:", validation.errors);

    // Show per-rename validation results
    for (const [symbolId, result] of validation.renameValidations) {
        if (!result.valid) {
            console.error(`  ${symbolId}:`, result.errors);
        }
    }

    // Show conflicting sets (e.g., duplicate target names, circular renames)
    if (validation.conflictingSets.length > 0) {
        console.error("Conflicting rename sets detected:");
        for (const set of validation.conflictingSets) {
            console.error(`  - ${set.join(", ")}`);
        }
    }
} else {
    console.log("Batch rename validation passed!");
    if (validation.warnings.length > 0) {
        console.warn("Warnings:", validation.warnings);
    }
    // Proceed with planBatchRename()
}
```

The batch validation detects:

- Invalid individual rename requests
- Duplicate target names (multiple symbols renamed to the same name)
- Circular rename chains (A→B, B→A or A→B→C→A)
- Cross-rename confusion (renaming to names that were original symbols in the batch)
- Each rename's individual validation status with hot reload checks (if requested)

This is essential for:

- Large refactoring operations affecting multiple related symbols
- IDE batch rename features
- Automated refactoring tools
- Ensuring atomicity and consistency in complex rename operations

### Cross-File Consistency Validation

Ensure renames maintain semantic consistency across file boundaries:

```javascript
import { validateCrossFileConsistency } from "@gmloop/refactor";

// Get occurrences for the symbol being renamed
const occurrences = await engine.gatherSymbolOccurrences("scr_player");

// Validate cross-file consistency
const errors = await validateCrossFileConsistency(
    "gml/script/scr_player",
    "scr_hero",
    occurrences,
    semantic
);

if (errors.length > 0) {
    console.error("Cross-file issues detected:");
    for (const error of errors) {
        if (error.severity === "warning") {
            console.warn(`  [${error.type}] ${error.message} in ${error.path}`);
        } else {
            console.error(
                `  [${error.type}] ${error.message} in ${error.path}`
            );
        }
    }
} else {
    console.log("✓ Rename maintains cross-file semantic consistency");
}
```

This validation is particularly useful for:

- Multi-file refactorings where symbols are imported/exported
- Detecting file-level symbol name conflicts before applying renames
- Warning about large-scale renames that affect many occurrences in a single file
- IDE integrations that need to show file-specific validation errors
- Ensuring import statements and references remain valid after renaming

### Structural Validation (Pre-flight Check)

Validate rename request structure before expensive operations like gathering occurrences. This provides fast fail-fast feedback for IDE integrations and CLI tools:

```javascript
import { validateRenameStructure } from "@gmloop/refactor";

// Quick structural validation before planning
const errors = await validateRenameStructure(
    "gml/script/scr_player",
    "scr_hero",
    semantic // Optional: validates symbol existence if provided
);

if (errors.length > 0) {
    console.error("Invalid rename request:", errors);
    // Display errors immediately without waiting for occurrence gathering
    return;
}

// Proceed with full rename planning
const workspace = await engine.planRename({
    symbolId: "gml/script/scr_player",
    newName: "scr_hero"
});
```

This is especially useful for:

- Fast validation in IDE real-time feedback (as users type)
- CLI argument validation before expensive operations
- API endpoint input validation
- Early error detection in batch operations

The function validates:

- Request parameter presence and types
- Identifier syntax (must match GML identifier pattern)
- Symbol existence (if semantic resolver provided)
- New name differs from old name

Unlike full validation, this does **not** check for:

- Shadowing conflicts (requires occurrence analysis)
- Reserved keywords (handled by `detectRenameConflicts`)
- Impact analysis (handled by `analyzeRenameImpact`)

### Direct Conflict Detection

Detect conflicts for a rename operation without going through full validation, useful for inline IDE warnings:

```javascript
const engine = new RefactorEngine({ semantic, parser, formatter });

// Get occurrences from semantic analyzer or parser
const occurrences = await engine.gatherSymbolOccurrences("player_hp");

// Check for conflicts directly
const conflicts = await engine.detectRenameConflicts({
    oldName: "player_hp",
    newName: "playerHealth",
    occurrences: occurrences
});

if (conflicts.length > 0) {
    for (const conflict of conflicts) {
        console.warn(`${conflict.type}: ${conflict.message}`);
        if (conflict.path) {
            console.warn(`  in file: ${conflict.path}`);
        }
    }
} else {
    console.log("No conflicts detected - rename is safe to proceed");
}
```

This method is especially useful for:

- IDE integrations that need real-time conflict checking as users type
- Custom refactoring tools that want low-level conflict information
- Building advanced rename workflows with custom conflict resolution
- Showing inline warnings before users commit to a rename operation

The method detects:

- Invalid identifier names (syntax errors)
- Reserved keyword conflicts
- Shadowing conflicts (new name collides with existing symbols in scope)
- Uses both default GML keywords and semantic analyzer's custom keyword list

### Batch Scope Validation

Efficiently validate rename safety across multiple scopes for hot reload scenarios:

```javascript
import { batchValidateScopeConflicts } from "@gmloop/refactor";

// Get occurrences from semantic analyzer
const occurrences = await engine.gatherSymbolOccurrences("player_hp");

// Batch validate across all scopes (more efficient than per-occurrence checks)
const conflicts = await batchValidateScopeConflicts(
    occurrences,
    "playerHealth",
    semantic
);

if (conflicts.size > 0) {
    console.log("Scope conflicts detected:");
    for (const [scopeId, conflict] of conflicts) {
        console.log(`  Scope ${scopeId}:`);
        console.log(`    ${conflict.message}`);
        console.log(`    Existing symbol: ${conflict.existingSymbol}`);
    }
} else {
    console.log("No scope conflicts - rename is safe across all scopes");
}
```

This function is especially useful for:

- Hot reload workflows that need to validate changes quickly before patching
- IDE integrations that show scope-specific warnings in real-time
- Batch rename operations where many occurrences need validation
- Reducing validation overhead by checking each unique scope only once instead of per-occurrence

Benefits:

- Groups occurrences by scope automatically
- Performs only one lookup per unique scope (not per occurrence)
- Returns structured conflict information per scope
- Handles both scoped and global (unscoped) occurrences correctly

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
the policy explicitly bans those affixes. Object-event assignment-backed fields
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
            "loopLengthHoisting": {
                "functionSuffixes": {
                    "array_length": "len"
                }
            }
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
`pnpm run test:ci` jobs catch regressions in both behavior and runtime.
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

### Rename Operations

#### Single Symbol Rename

```javascript
const engine = new RefactorEngine({ semantic, parser, formatter });

// Plan a rename
const workspace = await engine.planRename({
    symbolId: "gml/script/scr_old_name",
    newName: "scr_new_name"
});

// Execute the rename with hot reload support
const result = await engine.executeRename({
    symbolId: "gml/script/scr_old_name",
    newName: "scr_new_name",
    readFile: async (path) => await fs.readFile(path, "utf8"),
    writeFile: async (path, content) => await fs.writeFile(path, content),
    prepareHotReload: true
});
```

#### Batch Rename

```javascript
// Rename multiple related symbols atomically
const workspace = await engine.planBatchRename([
    { symbolId: "gml/script/scr_enemy_old", newName: "scr_enemy_new" },
    {
        symbolId: "gml/script/scr_enemy_helper_old",
        newName: "scr_enemy_helper_new"
    }
]);

// Execute batch rename
const result = await engine.executeBatchRename({
    renames: [
        { symbolId: "gml/script/scr_a", newName: "scr_x" },
        { symbolId: "gml/script/scr_b", newName: "scr_y" }
    ],
    readFile,
    writeFile,
    prepareHotReload: true
});
```

### Impact Analysis

Analyze the potential impact of a rename before committing to it:

```javascript
const analysis = await engine.analyzeRenameImpact({
    symbolId: "gml/script/scr_player_attack",
    newName: "scr_player_combat"
});

// analysis.summary contains:
// - oldName, newName
// - totalOccurrences, definitionCount, referenceCount
// - affectedFiles (array of file paths)
// - hotReloadRequired (boolean)
// - dependentSymbols (array of symbol IDs that depend on this symbol)

// analysis.conflicts contains any blocking issues
// analysis.warnings contains advisory information
```

### Hot Reload Safety Check

Check if a rename is safe for hot reload before planning:

```javascript
const safety = await engine.checkHotReloadSafety({
    symbolId: "gml/script/scr_player_attack",
    newName: "scr_player_combat"
});

if (!safety.safe) {
    console.error("Rename not safe:", safety.reason);
    if (safety.canAutoFix) {
        console.log("Auto-fix available. Suggestions:");
        safety.suggestions.forEach((s) => console.log(`  - ${s}`));
    }
} else {
    console.log("✓ Rename is hot-reload-safe");
    console.log("Requires restart:", safety.requiresRestart);
}

// Example outputs for different symbol types:
// - Scripts: safe=true, requiresRestart=false
// - Instance vars: safe=true, requiresRestart=false
// - Macros/enums: safe=false (recompilation needed), requiresRestart=false, canAutoFix=true
// - Reserved keywords: safe=false, requiresRestart=true, canAutoFix=false
```

### Hot Reload Validation

Validate that workspace edits won't break hot reload functionality:

```javascript
const workspace = await engine.planRename({
    symbolId: "gml/script/scr_test",
    newName: "scr_renamed"
});

const validation = await engine.validateHotReloadCompatibility(workspace, {
    checkTranspiler: true
});

if (!validation.valid) {
    console.error("Hot reload issues:", validation.errors);
}

// Check warnings for potential issues
validation.warnings.forEach((warning) => {
    console.warn(warning);
});
```

### Workspace Edit Management

```javascript
// Create workspace edits programmatically
const workspace = new WorkspaceEdit();
workspace.addEdit("scripts/player.gml", 10, 20, "newCode");
workspace.addEdit("scripts/enemy.gml", 30, 40, "moreCode");

// Group edits by file (sorted descending for safe application)
const grouped = workspace.groupByFile();

// Validate edits
const validation = await engine.validateRename(workspace);

// Apply edits
const results = await engine.applyWorkspaceEdit(workspace, {
    readFile: async (path) => await fs.readFile(path, "utf8"),
    writeFile: async (path, content) => await fs.writeFile(path, content),
    dryRun: false
});
```

### Hot Reload Integration

Prepare and generate hot reload updates after a refactor:

```javascript
// Prepare hot reload updates
const hotReloadUpdates = await engine.prepareHotReloadUpdates(workspace);

// Generate transpiler patches
const patches = await engine.generateTranspilerPatches(
    hotReloadUpdates,
    readFile
);

// patches array contains:
// - symbolId: the symbol being patched
// - patch: the transpiled code patch
// - filePath: source file path
```

### Post-Edit Semantic Validation

Verify that applied edits maintain semantic integrity and hot reload safety:

```javascript
// After applying a rename
const workspace = await engine.planRename({
    symbolId: "gml/script/scr_old",
    newName: "scr_new"
});

const results = await engine.applyWorkspaceEdit(workspace, {
    readFile: async (path) => await fs.readFile(path, "utf8"),
    writeFile: async (path, content) => await fs.writeFile(path, content)
});

// Verify the rename maintained semantic integrity
const validation = await engine.verifyPostEditIntegrity({
    symbolId: "gml/script/scr_old",
    oldName: "scr_old",
    newName: "scr_new",
    workspace,
    readFile: async (path) => await fs.readFile(path, "utf8")
});

if (!validation.valid) {
    console.error("Post-edit validation failed:", validation.errors);
    // Consider reverting changes or alerting the user
} else if (validation.warnings.length > 0) {
    console.warn("Post-edit warnings:", validation.warnings);
    // Review warnings but proceed with hot reload
}

// validation contains:
// - valid: boolean indicating if edits maintained integrity
// - errors: blocking issues that indicate the rename broke something
// - warnings: advisory information about potential issues
```

### Batch Rename Planning

Prepare a comprehensive plan for multiple coordinated renames before applying changes:

```javascript
const engine = new RefactorEngine({ semantic, parser, formatter });

// Plan multiple related renames with full validation and impact analysis
const plan = await engine.prepareBatchRenamePlan(
    [
        { symbolId: "gml/script/scr_enemy_old", newName: "scr_enemy_new" },
        { symbolId: "gml/script/scr_helper_old", newName: "scr_helper_new" }
    ],
    {
        validateHotReload: true,
        hotReloadOptions: { checkTranspiler: true }
    }
);

// Check batch-level validation
if (!plan.batchValidation.valid) {
    console.error("Batch validation failed:", plan.batchValidation.errors);

    // Show conflicting sets (e.g., duplicate target names, circular renames)
    for (const set of plan.batchValidation.conflictingSets) {
        console.error("Conflicting symbols:", set);
    }
    return;
}

// Review hot reload dependency cascade
if (plan.cascadeResult) {
    console.log(
        `Total symbols to reload: ${plan.cascadeResult.metadata.totalSymbols}`
    );
    console.log(
        `Max dependency distance: ${plan.cascadeResult.metadata.maxDistance}`
    );

    if (plan.cascadeResult.metadata.hasCircular) {
        console.warn("Circular dependencies detected:");
        for (const cycle of plan.cascadeResult.circular) {
            console.warn("  Cycle:", cycle.join(" → "));
        }
    }

    // Show reload order
    console.log("Reload order:", plan.cascadeResult.order);
}

// Review per-symbol impact analysis
for (const [symbolId, analysis] of plan.impactAnalyses) {
    console.log(`${symbolId}:`);
    console.log(`  Files affected: ${analysis.summary.affectedFiles.length}`);
    console.log(`  Total occurrences: ${analysis.summary.totalOccurrences}`);
    console.log(`  Definitions: ${analysis.summary.definitionCount}`);
    console.log(`  References: ${analysis.summary.referenceCount}`);
    console.log(`  Hot reload required: ${analysis.summary.hotReloadRequired}`);
    console.log(
        `  Dependent symbols: ${analysis.summary.dependentSymbols.length}`
    );

    if (analysis.conflicts.length > 0) {
        console.warn(
            "  Conflicts:",
            analysis.conflicts.map((c) => c.message)
        );
    }

    if (analysis.warnings.length > 0) {
        console.warn(
            "  Warnings:",
            analysis.warnings.map((w) => w.message)
        );
    }
}

// The plan includes:
// - plan.workspace: Combined workspace edit for all renames
// - plan.validation: Structural validation of merged edits
// - plan.hotReload: Hot reload compatibility validation (if requested)
// - plan.batchValidation: Batch-specific validation (conflicts, circular renames)
// - plan.impactAnalyses: Per-symbol impact analysis map
// - plan.cascadeResult: Full dependency cascade (if hot reload enabled)
```

This method provides a complete preview of batch rename operations, making it ideal for:

- IDE integrations that need to show comprehensive refactoring previews
- CLI tools that want to present detailed impact reports before applying changes
- Automated refactoring pipelines that need to validate complex multi-symbol renames
- Coordinated renames where dependencies between symbols must be considered

#### Advanced: Dependency Cascade Computation

Compute the full transitive closure of dependencies for hot reload operations:

```javascript
// Compute which symbols need reloading and in what order
const cascade = await engine.computeHotReloadCascade([
    "gml/script/scr_changed1",
    "gml/script/scr_changed2"
]);

// cascade.cascade: Array of all symbols that need reloading with metadata
// [
//   { symbolId: "gml/script/scr_changed1", distance: 0, reason: "direct change" },
//   { symbolId: "gml/script/scr_dependent", distance: 1, reason: "depends on scr_changed1" },
//   { symbolId: "gml/script/scr_transitive", distance: 2, reason: "depends on scr_dependent" }
// ]

// cascade.order: Symbols ordered for safe hot reload application (dependencies first)
// ["gml/script/scr_changed1", "gml/script/scr_dependent", "gml/script/scr_transitive"]

// cascade.circular: Array of detected circular dependency chains
// [["gml/script/scr_a", "gml/script/scr_b", "gml/script/scr_a"]]

// cascade.metadata: Summary information
// {
//   totalSymbols: 3,
//   maxDistance: 2,
//   hasCircular: false
// }
```

This is particularly useful for:

- Ensuring all dependent code is reloaded when a base symbol changes
- Detecting circular dependencies that could cause hot reload failures
- Ordering hot reload operations to prevent temporary inconsistencies
- Providing detailed diagnostics about why each symbol needs reloading

### Semantic Analyzer Integration

The refactor engine provides helper methods for querying the semantic analyzer,
making it easier to coordinate hot reload operations and dependency tracking:

#### Query File Symbols

Get all symbols defined in a specific file for targeted recompilation:

```javascript
// When a file changes, determine which symbols need recompilation
const symbols = await engine.getFileSymbols("scripts/scr_player.gml");

console.log(`File defines ${symbols.length} symbols:`);
for (const symbol of symbols) {
    console.log(`  - ${symbol.id}`);
}

// Use with hot reload cascade to find all affected symbols
const cascade = await engine.computeHotReloadCascade(symbols.map((s) => s.id));
```

#### Compute Rename Impact Graph

Generate a detailed dependency graph showing how a rename will propagate through the codebase:

```javascript
// Get comprehensive impact visualization for a rename
const impactGraph = await engine.computeRenameImpactGraph(
    "gml/script/scr_base"
);

console.log(`Rename will affect ${impactGraph.totalAffectedSymbols} symbols`);
console.log(`Maximum dependency depth: ${impactGraph.maxDepth}`);
console.log(`Critical path length: ${impactGraph.criticalPath.length}`);
console.log(
    `Estimated total reload time: ${impactGraph.estimatedTotalReloadTime}ms`
);

// Visualize the dependency graph
for (const [symbolId, node] of impactGraph.nodes) {
    console.log(
        `${node.symbolName} (distance: ${node.distance}, reload: ${node.estimatedReloadTime}ms)`
    );

    if (node.dependents.length > 0) {
        console.log(
            `  Depends on this: ${node.dependents.map((id) => id.split("/").pop()).join(", ")}`
        );
    }

    if (node.dependsOn.length > 0) {
        console.log(
            `  Depends on: ${node.dependsOn.map((id) => id.split("/").pop()).join(", ")}`
        );
    }
}

// Display critical path (longest dependency chain)
console.log("Critical path:");
for (let i = 0; i < impactGraph.criticalPath.length; i++) {
    const symbolId = impactGraph.criticalPath[i];
    const node = impactGraph.nodes.get(symbolId);
    const indent = "  ".repeat(i);
    console.log(`${indent}→ ${node.symbolName}`);
}
```

This is particularly useful for:

- Understanding the full scope of a rename before applying it
- Estimating hot reload impact and timing
- Identifying critical dependency chains that affect reload performance
- Visualizing dependency relationships in IDE tooling
- Planning batch renames to minimize reload cascades

````

#### Query Symbol Dependencies

Find which symbols depend on changed symbols to coordinate hot reload:

```javascript
// After modifying base scripts, find all dependents
const dependents = await engine.getSymbolDependents([
    "gml/script/scr_base_movement",
    "gml/script/scr_base_combat"
]);

console.log(`Found ${dependents.length} dependent symbols:`);
for (const dep of dependents) {
    console.log(`  - ${dep.symbolId} in ${dep.filePath}`);
}

// Recompile all dependents to maintain consistency
for (const dep of dependents) {
    await recompileSymbol(dep.symbolId, dep.filePath);
}
````

These methods provide a clean interface to the semantic analyzer and handle
cases where the analyzer is unavailable, making the refactor engine more
robust in partial-analysis scenarios.

### Occurrence Analysis Utilities

The refactor package provides utility functions to classify and analyze symbol
occurrences for rename planning and hot reload coordination:

#### Classify Occurrences

Break down occurrences into categories:

```javascript
const occurrences = await engine.gatherSymbolOccurrences("player_hp");
const classification = classifyOccurrences(occurrences);

console.log(`Total: ${classification.total}`);
console.log(`Definitions: ${classification.definitions}`);
console.log(`References: ${classification.references}`);
console.log(`Affected files: ${classification.byFile.size}`);

// Examine per-file breakdown
for (const [filePath, count] of classification.byFile) {
    console.log(`  ${filePath}: ${count} occurrences`);
}

// Examine by kind
for (const [kind, count] of classification.byKind) {
    console.log(`  ${kind}: ${count}`);
}
```

#### Filter and Group Occurrences

Focus on specific categories or files:

```javascript
import {
    filterOccurrencesByKind,
    groupOccurrencesByFile,
    findOccurrencesInFile,
    countAffectedFiles
} from "@gmloop/refactor";

// Get only definition sites
const definitions = filterOccurrencesByKind(occurrences, ["definition"]);

// Group by file for file-level analysis
const grouped = groupOccurrencesByFile(occurrences);
for (const [filePath, fileOccurrences] of grouped) {
    console.log(`${filePath}: ${fileOccurrences.length} occurrences`);
}

// Find occurrences in a specific file
const playerOccurrences = findOccurrencesInFile(
    occurrences,
    "scripts/scr_player.gml"
);

// Quick count of affected files
const fileCount = countAffectedFiles(occurrences);
console.log(`Rename will affect ${fileCount} files`);
```

These utilities are particularly useful for:

- Building rename preview UIs that show occurrence breakdowns
- Determining hot reload safety based on occurrence types
- Providing detailed impact summaries in CLI tools
- Filtering occurrences for targeted analysis

## Performance Optimization

### Semantic Query Cache

The refactor engine supports caching of semantic analyzer queries to optimize batch operations and impact analysis. During complex refactoring workflows, the same semantic data is often queried repeatedly (e.g., symbol occurrences, dependencies). The `SemanticQueryCache` memoizes these results within a session to reduce redundant queries.

```javascript
import { SemanticQueryCache } from "@gmloop/refactor";

// Create cache with custom configuration
const cache = new SemanticQueryCache(semantic, {
    maxSize: 100, // Maximum entries per cache type (default: 100)
    ttlMs: 60000, // Time-to-live in milliseconds (default: 60000)
    enabled: true // Enable/disable caching (default: true)
});

// First call queries the semantic analyzer
const occurrences1 = await cache.getSymbolOccurrences("player_hp");

// Second call returns cached result (no semantic query)
const occurrences2 = await cache.getSymbolOccurrences("player_hp");

// Clear cache when source files change
cache.invalidateAll();

// Or invalidate specific files
cache.invalidateFile("scripts/player.gml");

// Check cache performance
const stats = cache.getStats();
console.log(
    `Hits: ${stats.hits}, Misses: ${stats.misses}, Evictions: ${stats.evictions}`
);
```

The cache is particularly beneficial for:

- **Batch rename operations**: Avoids re-querying the same symbol dependencies multiple times
- **Impact analysis**: Caches occurrence data when analyzing multiple related symbols
- **Hot reload workflows**: Reduces overhead when computing dependency cascades
- **IDE integrations**: Provides faster feedback during interactive refactoring

**Cache behavior:**

- Entries are evicted using FIFO when `maxSize` is exceeded
- Setting `maxSize` to `0` makes the cache zero-capacity: calls still succeed, but fetched results are dropped immediately instead of being retained
- Entries expire after `ttlMs` milliseconds
- Each cache type (occurrences, file symbols, dependents, existence) has its own storage
- The cache is session-scoped and should be created per refactoring workflow
- Call `invalidateAll()` when source files change to prevent stale results
- Call `invalidateFile(path)` to selectively invalidate affected entries

### Rename Validation Cache

The refactor engine also provides a specialized cache for rename validation results. During interactive rename sessions (e.g., IDE rename dialogs), the same symbol-to-name combinations are often validated repeatedly as users type new names. The `RenameValidationCache` caches validation results to provide faster feedback for IDE integrations.

```javascript
import { RenameValidationCache } from "@gmloop/refactor";

// Create cache with custom configuration
const validationCache = new RenameValidationCache({
    maxSize: 50, // Maximum cached validation results (default: 50)
    ttlMs: 30000, // Time-to-live in milliseconds (default: 30000)
    enabled: true // Enable/disable caching (default: true)
});

// First validation: performs full validation with occurrence gathering and conflict detection
const result1 = await validationCache.getOrCompute(
    "gml/script/scr_player",
    "scr_hero",
    async () =>
        engine.validateRenameRequest({
            symbolId: "gml/script/scr_player",
            newName: "scr_hero"
        })
);

// Second validation within TTL: returns cached result instantly
const result2 = await validationCache.getOrCompute(
    "gml/script/scr_player",
    "scr_hero",
    async () =>
        engine.validateRenameRequest({
            symbolId: "gml/script/scr_player",
            newName: "scr_hero"
        })
);

// Invalidate specific symbol-name pair when symbol changes
validationCache.invalidate("gml/script/scr_player", "scr_hero");

// Invalidate all validation results for a symbol when its definition changes
validationCache.invalidateSymbol("gml/script/scr_player");

// Clear all cached validations when source files change
validationCache.invalidateAll();

// Check cache performance
const stats = validationCache.getStats();
console.log(
    `Hits: ${stats.hits}, Misses: ${stats.misses}, Evictions: ${stats.evictions}`
);
```

The validation cache is particularly beneficial for:

- **IDE rename dialogs**: Provides instant validation feedback as users type new names
- **Interactive refactoring**: Reduces latency during rename preview and validation
- **Autocomplete suggestions**: Enables fast validation of suggested names
- **Batch rename planning**: Speeds up validation when users adjust rename targets

**Cache behavior:**

- Entries are evicted using FIFO when `maxSize` is exceeded (oldest first)
- Entries expire after `ttlMs` milliseconds (shorter TTL than semantic cache)
- Each symbol-name pair has its own cache entry
- The cache is session-scoped and should be created per IDE session or refactoring workflow
- Call `invalidateAll()` when source files change to prevent stale validation results
- Call `invalidateSymbol(symbolId)` when a specific symbol's definition or dependencies change
- The cache stores the full validation result including errors, warnings, occurrence counts, and hot reload metadata

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

#### Example: Generating a Rename Preview

```javascript
const plan = await engine.prepareRenamePlan(
    {
        symbolId: "gml/script/scr_player",
        newName: "scr_hero"
    },
    { validateHotReload: true }
);

// Generate human-readable report
const report = formatRenamePlanReport(plan);
console.log(report);

// Output:
// Rename Plan Report
// ==================
// Symbol: scr_player → scr_hero
// Status: VALID
//
// Impact Summary:
//   Total Occurrences: 15
//   Definitions: 1
//   References: 14
//   Affected Files: 3
//   Hot Reload Required: Yes
//   Dependent Symbols: 2
//
// Workspace Changes:
//   Total Edits: 15
//   Files Modified: 3
//
// Hot Reload Status: SAFE
//   Reason: Script renames are hot-reload-safe
//   Requires Restart: No

// Generate detailed file-by-file preview
const preview = generateRenamePreview(plan.workspace, "scr_player", "scr_hero");
console.log(`Renaming ${preview.summary.oldName} → ${preview.summary.newName}`);
console.log(
    `Will modify ${preview.summary.affectedFiles} files with ${preview.summary.totalEdits} edits`
);

for (const file of preview.files) {
    console.log(`\n${file.filePath}: ${file.editCount} changes`);
    for (const edit of file.edits) {
        console.log(
            `  Position ${edit.start}-${edit.end}: "${edit.oldText}" → "${edit.newText}"`
        );
    }
}

// Format occurrence preview for user review
const occurrences = await engine.gatherSymbolOccurrences("scr_player");
const occPreview = formatOccurrencePreview(
    occurrences,
    "scr_player",
    "scr_hero"
);
console.log(occPreview);

// Output:
// Symbol Occurrences: scr_player → scr_hero
// Total: 15 occurrences in 3 files
//
// scripts/player.gml (10 occurrences):
//   [definition] Position 0-10
//   [reference] Position 45-55
//   [reference] Position 123-133
//   ...
//
// scripts/game.gml (3 occurrences):
//   [reference] Position 200-210
//   ...
```

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
