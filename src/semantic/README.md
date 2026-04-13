# Semantic Analyzer Subsystem

This `src/semantic` subsystem is a semantic layer that annotates parse tree(s) to add _meaning_ to the parsed GML code so the emitter/transpiler can make correct decisions. See the plan for this component/feature in [../../docs/semantic-scope-plan.md](../../docs/semantic-scope-plan.md).

## Ownership Boundaries

`@gmloop/semantic` is analysis-only.

- Owns project indexing, scope/symbol metadata, identifier occurrence discovery, and semantic classification.
- Does **not** own refactor edit planning or rename application.
- Does **not** depend on `@gmloop/refactor`.

Downstream tools consume semantic data:

- `@gmloop/refactor` uses semantic data to validate and plan workspace edits.
- `@gmloop/lint` uses semantic-backed/project-aware analysis services for lint rules.
- `@gmloop/cli` composes semantic consumers for lint/refactor command execution and formatter identifier-case runtime integration.
- `@gmloop/format` consumes only formatter runtime contracts, not semantic internals.

## Semantic Oracle

The `BasicSemanticOracle` class bridges the scope tracker and transpiler, providing identifier classification and symbol resolution for accurate code generation.

### Usage

```typescript
import { Semantic } from "@gmloop/semantic";

const tracker = new Semantic.ScopeTracker({ enabled: true });
const builtins = new Set(["show_debug_message", "array_length"]);
const scripts = new Set(["scr_player_move", "scr_enemy_attack"]);
const oracle = new Semantic.BasicSemanticOracle(tracker, builtins, scripts);

// Classify an identifier
const kind = oracle.kindOfIdent({ name: "myVar" });
// Returns: "local" | "global_field" | "builtin" | "script"

// Generate SCIP-style symbol for hot reload tracking
const symbol = oracle.qualifiedSymbol({ name: "scr_player_move" });
// Returns: "gml/script/scr_player_move"

// Determine call target type
const callKind = oracle.callTargetKind({
    type: "CallExpression",
    object: { name: "array_length" }
});
// Returns: "builtin" | "script" | "unknown"

// Get SCIP symbol for call target
const callSymbol = oracle.callTargetSymbol({
    type: "CallExpression",
    object: { name: "scr_player_move" }
});
// Returns: "gml/script/scr_player_move"
```

### Features

- **Identifier classification**: Uses scope resolution to classify identifiers as `local`, `global_field`, `builtin`, or `script`
- **SCIP symbol generation**: Produces SCIP-style symbols for project-wide tracking and hot reload coordination
- **Call target analysis**: Distinguishes builtin functions from script calls and unknown callables
- **Fallback mode**: Works without a scope tracker by returning sensible defaults
- **Type safety**: Uses type guards and helper functions for safe object validation

### Classification Priority

1. Global identifiers (explicit `isGlobalIdentifier` flag)
2. Built-in functions (matched against provided builtin set)
3. Script names (matched against provided script set)
4. Scope-resolved declarations (using scope chain walking)
5. Unresolved identifiers inside an object-event scope → `self_field`
6. Default to `local` for all other unresolved identifiers

Step 5 covers the common GML pattern where an object event accesses an instance variable by bare name (e.g., `hp -= 1` inside `Step_0`). Because these variables are never declared as locals, the scope-chain lookup fails and the oracle returns `self_field`, directing the transpiler to emit `self.hp -= 1`.

The scope kinds that trigger `self_field` classification are configurable via the `selfContextScopeKinds` constructor parameter (default: `{"object_event", "object_body"}`). Pass an empty set to disable `self_field` classification entirely.

**Note**: `other_field` classification is not implemented. The `other` keyword in GML produces a member-expression node (`other.x`) at the parser level, so the transpiler handles it structurally without oracle involvement.

### SCIP Symbol Format

SCIP symbols follow a deterministic URI-like format for cross-reference tracking:

- Scripts: `gml/script/{name}` (e.g., `gml/script/scr_player_move`)
- Global variables: `gml/var/global::{name}` (e.g., `gml/var/global::player_hp`)
- Built-ins: `gml/macro/{name}` (e.g., `gml/macro/array_length`)
- Local variables: `null` (locals don't need project-wide tracking)

These symbols enable hot reload pipelines to track dependencies and coordinate invalidation when symbols change.

## Scope Metadata Tracking

The `ScopeTracker` now supports enriched scope metadata to improve hot reload coordination and debugging. When entering a scope, you can optionally provide metadata including:

- `name`: Human-readable scope name (e.g., function name, object name)
- `path`: Source file path where the scope is defined
- `start`: Start location (line, column, index)
- `end`: End location (line, column, index)

### `getScopeMetadata(scopeId)`

Retrieve metadata for a specific scope, enabling file-based invalidation and source mapping.

```javascript
const tracker = new ScopeTracker({ enabled: true });

// Create a scope with full metadata
const scope = tracker.enterScope("function", {
    name: "updatePlayer",
    path: "scripts/player_movement/player_movement.gml",
    start: { line: 10, column: 0, index: 250 },
    end: { line: 25, column: 1, index: 500 }
});

const metadata = tracker.getScopeMetadata(scope.id);
// Returns: {
//   scopeId: "scope-0",
//   scopeKind: "function",
//   name: "updatePlayer",
//   path: "scripts/player_movement/player_movement.gml",
//   start: { line: 10, column: 0, index: 250 },
//   end: { line: 25, column: 1, index: 500 }
// }
```

**Use case:** Enable file-based hot reload invalidation by tracking which scopes belong to which source files. When a file changes, query all scopes in that file and compute their invalidation sets to determine what needs recompilation. The source range information supports precise source mapping for debugging and error reporting.

### `updateScopeMetadata(scopeId, metadata)`

Update stored scope metadata after a scope is created (for example, once the
file path or source range is known). The path index is refreshed when the path
changes, keeping file-based invalidation queries accurate.

```javascript
const tracker = new ScopeTracker({ enabled: true });
const scope = tracker.enterScope("function", { name: "initPlayer" });

tracker.updateScopeMetadata(scope.id, {
    path: "scripts/player/player.gml",
    start: { line: 1, column: 0, index: 0 }
});

const metadata = tracker.getScopeMetadata(scope.id);
// Returns: {
//   scopeId: "scope-0",
//   scopeKind: "function",
//   name: "initPlayer",
//   path: "scripts/player/player.gml",
//   start: { line: 1, column: 0, index: 0 },
//   end: undefined
// }
```

### `getScopesByPath(path)`

Get all scopes associated with a specific file path. This enables efficient hot reload invalidation when a file changes by quickly identifying all scopes in that file.

```javascript
const tracker = new ScopeTracker({ enabled: true });

// Create multiple scopes with path metadata
tracker.enterScope("program", {
    name: "player_movement",
    path: "scripts/player_movement/player_movement.gml"
});

tracker.enterScope("function", {
    name: "updatePlayer",
    path: "scripts/player_movement/player_movement.gml",
    start: { line: 10, column: 0, index: 250 },
    end: { line: 25, column: 1, index: 500 }
});

tracker.enterScope("function", {
    name: "resetPlayer",
    path: "scripts/player_movement/player_movement.gml",
    start: { line: 30, column: 0, index: 600 },
    end: { line: 35, column: 1, index: 700 }
});

const scopes = tracker.getScopesByPath(
    "scripts/player_movement/player_movement.gml"
);
// Returns: [
//   {
//     scopeId: "scope-0",
//     scopeKind: "program",
//     name: "player_movement",
//     start: undefined,
//     end: undefined
//   },
//   {
//     scopeId: "scope-1",
//     scopeKind: "function",
//     name: "updatePlayer",
//     start: { line: 10, column: 0, index: 250 },
//     end: { line: 25, column: 1, index: 500 }
//   },
//   {
//     scopeId: "scope-2",
//     scopeKind: "function",
//     name: "resetPlayer",
//     start: { line: 30, column: 0, index: 600 },
//     end: { line: 35, column: 1, index: 700 }
//   }
// ]
```

**Use case:** Essential for file-based hot reload. When a file changes, call this method to get all scopes defined in that file. For each scope, you can then call `getInvalidationSet()` to determine what downstream code needs recompilation. The method uses an internal index for O(1) average-case lookup, making it efficient even for large projects with thousands of scopes.

**Performance:** This method provides constant-time lookup regardless of the total number of scopes in the tracker, as it uses an internal path-to-scope index. This is significantly faster than scanning all scopes, which would be O(n).

## Symbol Resolution Queries

The `ScopeTracker` provides query methods that enable hot reload coordination and dependency tracking:

### `getAllSymbolsSummary()`

Get a global summary of all symbols across all scopes. Returns aggregated metadata for each unique symbol showing which scopes declare and reference it, along with occurrence counts. This provides a bird's-eye view of the entire symbol table without iterating through individual scopes.

```javascript
const tracker = new ScopeTracker({ enabled: true });
// ... track declarations and references across multiple scopes ...
const summary = tracker.getAllSymbolsSummary();
// Returns: [
//   {
//     name: "GameState",
//     scopeCount: 3,
//     declarationCount: 1,
//     referenceCount: 5,
//     scopes: [
//       { scopeId: "scope-0", scopeKind: "program", hasDeclaration: true, hasReference: false },
//       { scopeId: "scope-1", scopeKind: "function", hasDeclaration: false, hasReference: true },
//       { scopeId: "scope-2", scopeKind: "function", hasDeclaration: false, hasReference: true }
//     ]
//   },
//   { name: "localVar", scopeCount: 1, declarationCount: 1, referenceCount: 2, scopes: [...] }
// ]
```

**Use case:** Quick assessment of symbol usage patterns for hot reload coordination. Provides a global view of which symbols are most widely used across the project, helping identify high-impact symbols that require careful invalidation when modified. The aggregated counts enable prioritization of hot reload optimizations and detection of potential bottlenecks in dependency graphs.

### `getScopeOccurrences(scopeId, options)`

Export declaration and reference metadata for a single scope without scanning
the entire graph. Useful when responding to focused hot reload events that only
touch one file.

```javascript
const result = tracker.getScopeOccurrences("scope-1", {
    includeReferences: false
});
// Returns:
// {
//   scopeId: "scope-1",
//   scopeKind: "block",
//   lastModified: 1703123458000,
//   modificationCount: 2,
//   identifiers: [
//     {
//       name: "localVar",
//       declarations: [...],
//       references: []
//     }
//   ]
// }
```

**Use case:** Emit targeted invalidation payloads for a single scope. The method
mirrors `exportOccurrences` but avoids iterating through every scope in the
tracker, making per-file queries cheaper during hot reload. The response also
includes modification timestamps and counters so hot reload pipelines can
detect freshness without issuing separate metadata lookups.

### `exportModifiedOccurrences(sinceTimestamp, options)`

Export declaration and reference metadata only for scopes modified after a given timestamp. This is optimized for hot reload scenarios where only a subset of files have changed, avoiding expensive cloning of unchanged scopes.

```javascript
const tracker = new ScopeTracker({ enabled: true });
// ... track declarations and references across multiple scopes ...

// Capture checkpoint before changes
const checkpoint = Date.now();

// ... modify some scopes (e.g., from file edits) ...

// Export only the scopes modified after checkpoint
const modified = tracker.exportModifiedOccurrences(checkpoint, {
    includeReferences: true
});
// Returns: [
//   {
//     scopeId: "scope-5",
//     scopeKind: "function",
//     lastModified: 1703123460000,
//     modificationCount: 3,
//     identifiers: [
//       { name: "updatedVar", declarations: [...], references: [...] }
//     ]
//   }
// ]
```

**Use case:** During hot reload, export only the scopes that changed since the last build or checkpoint. This dramatically reduces the data volume and processing time compared to exporting all scopes, especially in large projects. The method is particularly effective when combined with file watchers that can track which scopes correspond to edited files.

**Performance:** In a project with 100 scopes where only 2 have changed, this method processes and clones data for only the 2 modified scopes instead of all 100, reducing memory allocations and CPU time by ~98%. Each scope's modification timestamp is checked in O(1) time, making the scan itself very efficient.

### `getSymbolOccurrences(name)`

Find all occurrences (declarations and references) of a specific symbol across all scopes. Returns an array of occurrence records with scope context.

**Safety:** Occurrence objects are cloned to prevent external mutation of internal state. For read-only analysis where performance is critical, use `getSymbolOccurrencesUnsafe()` instead.

```javascript
const tracker = new ScopeTracker({ enabled: true });
// ... track declarations and references ...
const occurrences = tracker.getSymbolOccurrences("myVariable");
// Returns: [
//   { scopeId: "scope-0", scopeKind: "function", kind: "declaration", occurrence: {...} },
//   { scopeId: "scope-1", scopeKind: "block", kind: "reference", occurrence: {...} }
// ]
```

**Use case:** Identify what needs to be recompiled when a symbol changes, supporting faster invalidation in hot reload pipelines.

### `getSymbolOccurrencesUnsafe(name)`

**UNSAFE**: Returns symbol occurrences without cloning occurrence objects. The returned occurrence objects are direct references to internal state and **MUST NOT** be modified by the caller.

```javascript
const tracker = new ScopeTracker({ enabled: true });
// ... track declarations and references ...

// For read-only analysis (30-50% faster, zero allocation overhead)
const occurrences = tracker.getSymbolOccurrencesUnsafe("myVariable");

// ✅ OK: Read occurrence data
const firstOccurrenceName = occurrences[0].occurrence.name;
const declarationLine = occurrences[0].occurrence.start?.line;

// ❌ FORBIDDEN: Modify occurrence objects
// occurrences[0].occurrence.name = "modified"; // Will corrupt internal state!
```

**Use case:** Performance-critical hot-reload scenarios such as dependency graph traversal, invalidation set computation, or symbol cross-reference reporting where occurrence objects are only read, never modified.

**Performance:** Eliminates all occurrence cloning overhead (~30-50% faster for large queries) and reduces GC pressure by avoiding allocation of cloned objects.

### `getBatchSymbolOccurrences(names)`

Find all occurrences (declarations and references) for multiple symbols in a single query. This is more efficient than calling `getSymbolOccurrences` multiple times, as it batches the lookups and minimizes redundant scope traversals.

**Safety:** Occurrence objects are cloned to prevent external mutation of internal state. For read-only analysis where performance is critical, use `getBatchSymbolOccurrencesUnsafe()` instead.

```javascript
const tracker = new ScopeTracker({ enabled: true });
// ... track declarations and references across multiple scopes ...

// When multiple symbols change (e.g., in a file edit), query them all at once
const changedSymbols = ["CONFIG_MAX_HP", "CONFIG_MAX_MP", "initPlayer"];
const results = tracker.getBatchSymbolOccurrences(changedSymbols);

// Returns: Map<string, Array<{scopeId, scopeKind, kind, occurrence}>>
// Each entry maps a symbol name to its occurrence records:
// Map {
//   "CONFIG_MAX_HP" => [
//     { scopeId: "scope-0", scopeKind: "program", kind: "declaration", occurrence: {...} },
//     { scopeId: "scope-1", scopeKind: "function", kind: "reference", occurrence: {...} }
//   ],
//   "CONFIG_MAX_MP" => [...],
//   "initPlayer" => [...]
// }

// Symbols not found are omitted from the result (not mapped to empty arrays)
```

The method accepts any iterable of symbol names (Array, Set, etc.) and returns a Map. Symbols that have no occurrences are omitted from the result entirely.

**Use case:** When a file changes during hot reload and multiple symbols are modified, batch-query all affected symbols to determine the complete invalidation set without N individual lookups. This provides better performance than sequential queries, especially in large projects with many symbols.

**Performance:** For querying N symbols, this method performs O(N) lookups against the internal symbol index, compared to O(N) separate method calls if using `getSymbolOccurrences` individually. The batching also improves cache locality and reduces function call overhead.

### `getBatchSymbolOccurrencesUnsafe(names)`

**UNSAFE**: Returns batch symbol occurrences without cloning occurrence objects. The returned occurrence objects are direct references to internal state and **MUST NOT** be modified by the caller.

```javascript
const tracker = new ScopeTracker({ enabled: true });
// ... track many symbols across large codebase ...

// For bulk dependency analysis (faster than safe variant, ideal for hot reload)
const changedSymbols = new Set([
    "CONFIG_MAX_HP",
    "CONFIG_MAX_MP",
    "initPlayer"
]);
const results = tracker.getBatchSymbolOccurrencesUnsafe(changedSymbols);

// ✅ OK: Analyze occurrence data
for (const [symbol, occurrences] of results) {
    for (const occ of occurrences) {
        console.log(`${symbol} ${occ.kind} in ${occ.scopeId}`);
    }
}

// ❌ FORBIDDEN: Modify occurrence objects
// results.get("CONFIG_MAX_HP")[0].occurrence.name = "modified"; // Corrupts internal state!
```

**Use case:** High-performance bulk invalidation queries during hot-reload where 100+ symbols may change simultaneously. Particularly effective for large projects where allocation overhead of cloning becomes significant.

**Performance:** Combines the benefits of batch processing with zero-copy access. For 200 symbols with multiple occurrences each, this can be 30-50% faster than the safe variant and significantly reduces GC pressure.

### `getScopeSymbols(scopeId)`

Get all unique identifier names declared or referenced in a specific scope. Returns an array of symbol names.

```javascript
const symbols = tracker.getScopeSymbols("scope-0");
// Returns: ["param1", "param2", "localVar"]
```

**Use case:** Track dependencies and enable selective recompilation by understanding which symbols are used in each scope.

### `resolveIdentifier(name, scopeId)`

Resolve an identifier to its declaration metadata by walking up the scope chain. Implements proper lexical scoping rules with shadowing support.

```javascript
const declaration = tracker.resolveIdentifier("myVar", "scope-1");
// Returns: { name: "myVar", scopeId: "scope-0", classifications: [...], start: {...}, end: {...} }
```

**Use case:** Accurate binding resolution for transpilation, enabling correct code generation that respects lexical scope boundaries.

### `getScopeChain(scopeId)`

Get the parent scope chain for a given scope, walking from the specified scope up to the root. Returns an array of scope descriptors from nearest to root.

```javascript
const chain = tracker.getScopeChain("scope-2");
// Returns: [
//   { id: "scope-2", kind: "block" },
//   { id: "scope-1", kind: "function" },
//   { id: "scope-0", kind: "program" }
// ]
```

**Use case:** Efficient dependency tracking and faster invalidation in hot reload pipelines by traversing lexical scope hierarchies without walking the full scope stack.

### `getScopeDefinitions(scopeId)`

Get all declarations defined directly in a specific scope (not including parent scopes). Returns an array of declaration records with names and metadata.

```javascript
const definitions = tracker.getScopeDefinitions("scope-1");
// Returns: [
//   { name: "localVar", metadata: { scopeId: "scope-1", classifications: [...], start: {...}, end: {...} } },
//   { name: "param", metadata: { scopeId: "scope-1", classifications: [...], start: {...}, end: {...} } }
// ]
```

**Use case:** Identify what symbols are defined in a particular file or scope unit for hot reload coordination. When a file changes, query its scope's definitions to determine which symbols need to be recompiled and which dependent files need to be invalidated.

### `getAllDeclarations()`

Get all symbol declarations across all scopes in the tracker. Returns an array of declaration records with scope context, enabling project-wide symbol analysis for dependency graphs, refactoring, and hot reload coordination.

```javascript
const tracker = new ScopeTracker({ enabled: true });
// ... track declarations across multiple scopes ...
const allDeclarations = tracker.getAllDeclarations();
// Returns: [
//   { name: "GameState", scopeId: "scope-0", scopeKind: "program", metadata: {...} },
//   { name: "globalVar", scopeId: "scope-0", scopeKind: "program", metadata: {...} },
//   { name: "localVar", scopeId: "scope-1", scopeKind: "function", metadata: {...} },
//   { name: "param", scopeId: "scope-1", scopeKind: "function", metadata: {...} }
// ]
```

**Use case:** Build a complete symbol table for the project to power IDE features (go-to-definition, find-all-references), refactoring tools (rename, extract function), and hot reload dependency tracking. The method returns declarations sorted by scope ID then symbol name for consistent iteration.

### `getDeclarationInScope(name, scopeId)`

Get metadata for a specific symbol declaration by name and scope. Returns the declaration metadata if found, or null if the symbol is not declared in the specified scope.

```javascript
const metadata = tracker.getDeclarationInScope("localVar", "scope-1");
// Returns: { name: "localVar", scopeId: "scope-1", classifications: [...], start: {...}, end: {...} }
```

**Use case:** Efficient single-symbol lookup when you need to check if a symbol is declared in a known scope. This is more efficient than `getAllDeclarations()` for targeted queries during incremental analysis or refactoring validation.

### `getScopesForSymbol(name)`

Get all scope IDs that contain occurrences (declarations or references) of a specific symbol. This method uses an internal index for O(1) average-case lookup, making it significantly faster than scanning all scopes.

```javascript
const scopeIds = tracker.getScopesForSymbol("myVariable");
// Returns: ["scope-0", "scope-2", "scope-5"]
```

**Use case:** Hot reload invalidation optimization. When a symbol changes, quickly identify all scopes that need recompilation without iterating through the entire scope tree. This is particularly valuable for large projects where linear scans would be prohibitively expensive. The index-based lookup provides near-constant-time performance regardless of project size.

### `getScopeExternalReferences(scopeId)`

Get all external references from a specific scope—references to symbols declared in parent or ancestor scopes. Returns an array where each entry includes the symbol name, the scope where it was declared (or `null` if undeclared), and all occurrence records.

```javascript
const externalRefs = tracker.getScopeExternalReferences("scope-1");
// Returns: [
//   {
//     name: "globalVar",
//     declaringScopeId: "scope-0",
//     referencingScopeId: "scope-1",
//     occurrences: [{kind: "reference", name: "globalVar", scopeId: "scope-1", ...}]
//   }
// ]
```

**Use case:** Cross-scope dependency tracking for hot reload coordination. When editing a file/scope, query its external references to understand which parent symbols it depends on. This enables precise invalidation: if a parent scope's symbol changes, you can quickly identify all child scopes that reference it and selectively recompile only the affected code paths. This is essential for efficient hot reload in large projects where rebuilding everything would be prohibitively slow.

### `getScopeDependencies(scopeId)`

Get all scopes that a given scope depends on (scopes it references symbols from). This builds a direct dependency list by analyzing external references and resolving where those symbols are declared.

```javascript
const tracker = new ScopeTracker({ enabled: true });

// Program scope declares symbols
tracker.enterScope("program");
tracker.declare("globalConfig", {...});

// Function scope references global symbols
const fnScope = tracker.enterScope("function");
tracker.reference("globalConfig", {...});

const dependencies = tracker.getScopeDependencies(fnScope.id);
// Returns: [
//   {
//     dependencyScopeId: "scope-0",
//     dependencyScopeKind: "program",
//     symbols: ["globalConfig"]
//   }
// ]
```

**Use case:** When a scope changes, query which scopes it depends on to determine if those dependencies have changed and require recompilation. This enables precise invalidation in hot reload pipelines by understanding the dependency graph.

### `getScopeDependents(scopeId)`

Get all scopes that depend on a given scope (scopes that reference symbols declared in the queried scope). This is the inverse of `getScopeDependencies` and is critical for hot reload invalidation.

```javascript
const tracker = new ScopeTracker({ enabled: true });

// Program scope declares a symbol
const programScope = tracker.enterScope("program");
tracker.declare("globalVar", {...});

// Function scope references the global symbol
const fnScope = tracker.enterScope("function");
tracker.reference("globalVar", {...});

const dependents = tracker.getScopeDependents(programScope.id);
// Returns: [
//   {
//     dependentScopeId: "scope-1",
//     dependentScopeKind: "function",
//     symbols: ["globalVar"]
//   }
// ]
```

**Use case:** When a scope changes, query which scopes depend on it to identify what needs to be invalidated and recompiled. This is essential for efficient hot reload: if scope A declares symbol X and scope B references X, then changing scope A requires recompiling scope B.

### `getTransitiveDependents(scopeId)`

Get all scopes that transitively depend on a given scope. This computes the full dependency closure by recursively following dependent relationships. Unlike `getScopeDependents` which returns only direct dependents, this method returns all scopes in the dependency tree.

```javascript
const tracker = new ScopeTracker({ enabled: true });

// Scope A declares symbol X
const scopeA = tracker.enterScope("program");
tracker.declare("symbolX", {...});

// Scope B depends on A (references X) and declares Y
const scopeB = tracker.enterScope("function");
tracker.reference("symbolX", {...});
tracker.declare("symbolY", {...});

// Scope C nested in B depends on B (references Y)
const scopeC = tracker.enterScope("block");
tracker.reference("symbolY", {...});
tracker.exitScope();

const transitive = tracker.getTransitiveDependents(scopeA.id);
// Returns: [
//   { dependentScopeId: "scope-1", dependentScopeKind: "function", depth: 1 },  // B
//   { dependentScopeId: "scope-2", dependentScopeKind: "block", depth: 2 }      // C
// ]
```

**Use case:** Essential for hot reload invalidation when a scope changes. Identifies not just the immediate dependents but all scopes that transitively depend on the changed scope, ensuring the entire dependency chain is recompiled. The depth field indicates how far removed each dependent is from the root scope.

### `getInvalidationSet(scopeId, options?)`

Calculate the complete invalidation set for a given scope - all scopes that need recompilation if the given scope changes. This includes the scope itself, all transitive dependents, and optionally all descendant scopes (children nested within it).

```javascript
const tracker = new ScopeTracker({ enabled: true });

const scopeA = tracker.enterScope("program");
tracker.declare("globalVar", {...});

const scopeB = tracker.enterScope("function");
tracker.reference("globalVar", {...});

const invalidationSet = tracker.getInvalidationSet(scopeA.id);
// Returns: [
//   { scopeId: "scope-0", scopeKind: "program", reason: "self" },
//   { scopeId: "scope-1", scopeKind: "function", reason: "dependent" }
// ]

// Include nested child scopes
const fullSet = tracker.getInvalidationSet(scopeA.id, { includeDescendants: true });
// Returns: [
//   { scopeId: "scope-0", scopeKind: "program", reason: "self" },
//   { scopeId: "scope-1", scopeKind: "function", reason: "descendant" },
//   { scopeId: "scope-2", scopeKind: "block", reason: "dependent" }
// ]
```

**Use case:** Primary method for hot reload coordination. When a file/scope changes, call this method to determine the complete set of scopes that need recompilation. The `reason` field indicates why each scope is included: 'self' (the changed scope), 'dependent' (depends on the changed scope), or 'descendant' (nested within the changed scope).

### `getDescendantScopes(scopeId)`

Get all descendant scopes (children, grandchildren, etc.) of a given scope. This traverses the scope tree depth-first to find all nested scopes.

```javascript
const tracker = new ScopeTracker({ enabled: true });

const root = tracker.enterScope("program");

const child = tracker.enterScope("function");
const grandchild = tracker.enterScope("block");

const descendants = tracker.getDescendantScopes(root.id);
// Returns: [
//   { scopeId: "scope-1", scopeKind: "function", depth: 1 },
//   { scopeId: "scope-2", scopeKind: "block", depth: 2 }
// ]
```

**Use case:** Useful for hot reload when you want to invalidate an entire scope tree, not just the direct children. For example, when a file changes, you might want to invalidate all scopes defined within that file. The depth field indicates the nesting level from the queried scope.

### `exportScipOccurrences(options?)`

Export occurrences in SCIP (SCIP Code Intelligence Protocol) format for hot reload coordination and cross-file dependency tracking. SCIP format represents each occurrence with a range tuple `[startLine, startCol, endLine, endCol]`, a qualified symbol identifier, and role flags indicating DEF (declaration) or REF (reference).

```javascript
const tracker = new ScopeTracker({ enabled: true });
tracker.enterScope("program");
tracker.declare("gameState", {
    name: "gameState",
    start: { line: 1, column: 0, index: 0 },
    end: { line: 1, column: 9, index: 9 }
});
tracker.reference("gameState", {
    name: "gameState",
    start: { line: 5, column: 4, index: 50 },
    end: { line: 5, column: 13, index: 59 }
});

const scipData = tracker.exportScipOccurrences();
// Returns: [
//   {
//     scopeId: "scope-0",
//     scopeKind: "program",
//     occurrences: [
//       { range: [1, 0, 1, 9], symbol: "scope-0::gameState", symbolRoles: 1 },  // DEF
//       { range: [5, 4, 5, 13], symbol: "scope-0::gameState", symbolRoles: 0 }  // REF
//     ]
//   }
// ]
```

**Options:**

- `scopeId`: Limit export to a specific scope (omit for all scopes)
- `includeReferences`: Include reference occurrences (default: `true`)
- `symbolGenerator`: Custom function to generate qualified symbol names. Default format is `"scopeId::name"`.

**Use case:** When a file changes during hot reload, export its SCIP occurrences to determine which symbols changed and which dependent files need recompilation. The SCIP format enables:

- Tracking which symbols are defined/referenced in each file
- Building cross-file dependency graphs for selective recompilation
- Identifying downstream code that needs invalidation when symbols change
- Supporting IDE features like go-to-definition and find-all-references

The custom symbol generator allows integration with project-wide symbol naming schemes. For example, use `(name, scopeId) => "gml/script/" + name` to match the transpiler's qualified symbol format for scripts.

### `exportOccurrencesBySymbols(symbolNames, options?)`

Export occurrences for a specific set of symbols in SCIP format, enabling targeted occurrence export for hot reload coordination when only specific symbols have changed. Unlike `exportScipOccurrences`, which exports all symbols or all symbols in a scope, this method filters to only the requested symbol names, reducing payload size and processing time during incremental updates.

```javascript
const tracker = new ScopeTracker({ enabled: true });
tracker.enterScope("program");
tracker.declare("player_hp", {
    name: "player_hp",
    start: { line: 1, column: 0, index: 0 },
    end: { line: 1, column: 9, index: 9 }
});
tracker.declare("enemy_count", {
    name: "enemy_count",
    start: { line: 2, column: 0, index: 20 },
    end: { line: 2, column: 11, index: 31 }
});
tracker.declare("game_state", {
    name: "game_state",
    start: { line: 3, column: 0, index: 40 },
    end: { line: 3, column: 10, index: 50 }
});

// Export occurrences for only the symbols that changed
const changedSymbols = ["player_hp", "enemy_count"];
const occurrences = tracker.exportOccurrencesBySymbols(changedSymbols);
// Returns: [
//   {
//     scopeId: "scope-0",
//     scopeKind: "program",
//     occurrences: [
//       { range: [1, 0, 1, 9], symbol: "scope-0::player_hp", symbolRoles: 1 },
//       { range: [2, 0, 2, 11], symbol: "scope-0::enemy_count", symbolRoles: 1 }
//     ]
//   }
// ]
// Note: game_state is not included because it wasn't in the requested set
```

**Parameters:**

- `symbolNames`: Iterable<string> - Set or array of symbol names to export
- `options.scopeId`: Limit export to a specific scope (omit for all scopes)
- `options.includeReferences`: Include reference occurrences (default: `true`)
- `options.symbolGenerator`: Custom function to generate qualified symbol names. Default format is `"scopeId::name"`.

**Returns:** Array of scope occurrence payloads in SCIP format, sorted by scope ID. Scopes with no matching symbols are omitted from the result.

**Use case:** Essential for incremental hot reload when a file edit changes only a subset of symbols. Instead of exporting all occurrences (which can be expensive for large codebases), query only the symbols that changed. For example:

1. File watcher detects edit to `player.gml`
2. Parse the file to identify changed symbols: `["player_hp", "player_update"]`
3. Call `exportOccurrencesBySymbols(["player_hp", "player_update"])` to get targeted occurrences
4. Use the filtered occurrences to build a minimal invalidation set
5. Send only the affected code to the hot reload pipeline

This targeted approach dramatically reduces hot reload latency in large projects by avoiding full-project symbol exports on every file change.

## Scope Modification Tracking

The `ScopeTracker` maintains modification metadata for each scope, enabling efficient incremental hot reload by tracking when scopes change and identifying which scopes need recompilation.

### `getScopeModificationMetadata(scopeId)`

Get modification metadata for a specific scope, including the last modification timestamp and total modification count.

```javascript
const metadata = tracker.getScopeModificationMetadata("scope-1");
// Returns: {
//   scopeId: "scope-1",
//   scopeKind: "function",
//   lastModified: 1703123456789,
//   modificationCount: 5
// }
```

**Use case:** Track when specific scopes were last modified to determine if they need recompilation during hot reload.

### `getModifiedScopes(sinceTimestamp)`

Get all scopes modified after a specific timestamp. This enables incremental hot reload by identifying only the scopes that have changed since the last compilation.

```javascript
const lastCompileTime = Date.now();
// ... user makes changes ...
const modifiedScopes = tracker.getModifiedScopes(lastCompileTime);
// Returns: [
//   { scopeId: "scope-2", scopeKind: "block", lastModified: 1703123457000, modificationCount: 3 }
// ]
```

**Use case:** Incremental compilation during hot reload. Instead of rebuilding the entire project, identify and recompile only the scopes that changed since the last build, dramatically reducing compilation time.

### `getMostRecentlyModifiedScope()`

Get the most recently modified scope across all tracked scopes.

```javascript
const mostRecent = tracker.getMostRecentlyModifiedScope();
// Returns: {
//   scopeId: "scope-3",
//   scopeKind: "function",
//   lastModified: 1703123458000,
//   modificationCount: 2
// }
```

**Use case:** Quick identification of the latest change in the symbol table for hot reload coordination and incremental invalidation.

### `getScopeModificationDetails(scopeId)`

Get detailed modification metadata for a specific scope, including counts of declarations and references tracked. This provides richer information than `getScopeModificationMetadata` for hot reload systems that need to understand what type of changes occurred in a scope.

```javascript
const details = tracker.getScopeModificationDetails("scope-1");
// Returns: {
//   scopeId: "scope-1",
//   scopeKind: "function",
//   lastModified: 1703123456789,
//   modificationCount: 5,
//   declarationCount: 2,
//   referenceCount: 3,
//   symbolCount: 2,
//   symbols: [
//     { name: "localVar", declarationCount: 1, referenceCount: 2 },
//     { name: "param", declarationCount: 1, referenceCount: 1 }
//   ]
// }
```

**Use case:** Smart hot reload invalidation decisions. When a scope changes, query its modification details to understand the nature of the change. For example, if only references were added (no new declarations), dependent scopes may not need full recompilation. The per-symbol breakdown enables precise tracking of which symbols drive the modification count, helping hot reload systems prioritize invalidation of high-impact symbols over low-impact ones.

## Usage Context Tracking

Occurrences now include `usageContext` metadata that distinguishes how identifiers are used (read vs. write, call target, etc.), enabling smarter dependency analysis and invalidation.

### `getSymbolWrites(name)`

Get all write operations (assignments) for a specific symbol across all scopes. This supports hot reload invalidation by identifying which scopes write to a symbol.

```javascript
const writes = tracker.getSymbolWrites("counter");
// Returns: [
//   {
//     scopeId: "scope-1",
//     scopeKind: "function",
//     occurrence: {
//       kind: "reference",
//       name: "counter",
//       usageContext: { isWrite: true, isAssignmentTarget: true },
//       ...
//     }
//   }
// ]
```

**Use case:** Precise dependency tracking. When a variable's value changes, identify exactly which scopes perform writes to enable targeted invalidation for hot reload.

### `getSymbolReads(name)`

Get all read operations for a specific symbol across all scopes. This helps identify dependencies when a symbol's value changes.

```javascript
const reads = tracker.getSymbolReads("gameState");
// Returns: [
//   {
//     scopeId: "scope-2",
//     scopeKind: "block",
//     occurrence: {
//       kind: "reference",
//       name: "gameState",
//       usageContext: { isRead: true },
//       ...
//     }
//   }
// ]
```

**Use case:** Identify which scopes read a symbol to enable targeted invalidation during hot reload. When a symbol's value changes, recompile only the scopes that actually read it.

### Usage Context Properties

Each reference occurrence includes a `usageContext` object with the following properties:

- `isRead`: `true` if the identifier is read
- `isWrite`: `true` if the identifier is written/assigned to
- `isAssignmentTarget`: `true` if the identifier appears on the left side of an assignment
- `isCallTarget`: `true` if the identifier is being called as a function
- `parentType`: Optional string indicating the parent AST node type

**Note:** Declarations have `usageContext: null` since they establish bindings rather than use them.

## Hot-Reload Invalidation & File Re-Analysis

These methods implement the four-step hot-reload workflow that keeps the scope
graph consistent when source files change.

### Recommended Workflow

```
1. getImpactedFilePaths(changedPaths)   → Set<string>  (expand change set)
2. sortPathsForReanalysis(impacted)     → string[]     (order before clearing)
3. clearScopesForPath(path) for each   → removes stale scopes
4. re-parse each path in sorted order  → registers fresh scopes
```

Steps 2 and 3 must be performed in this sequence: **sort first, then clear**.
`sortPathsForReanalysis` reads the current scope graph to determine dependency
order; once scopes are cleared that information is gone.

---

### `getImpactedFilePaths(changedPaths)`

Returns the complete set of file paths that need re-analysis when the given
paths change, by expanding each changed path to its full transitive set of
dependents.

```javascript
const tracker = new ScopeTracker({ enabled: true });

// Register scopes during initial parse.
tracker.enterScope("program", { path: "/lib.gml" });
tracker.declare("utils", {
    name: "utils",
    start: { line: 1, index: 0 },
    end: { line: 1, index: 5 }
});
tracker.enterScope("file", { path: "/app.gml" });
tracker.reference("utils", {
    name: "utils",
    start: { line: 3, index: 0 },
    end: { line: 3, index: 5 }
});
tracker.exitScope(); // app.gml
tracker.exitScope(); // lib.gml

const impacted = tracker.getImpactedFilePaths(["/lib.gml"]);
// Returns: Set { "/lib.gml", "/app.gml" }
```

**Use case:** First step in the hot-reload workflow. Takes the set of files that
have actually changed on disk and expands it to all files that must be
re-analysed because they (transitively) depend on the changed symbols.

---

### `sortPathsForReanalysis(paths)`

Sorts a collection of file paths into dependency order so that a file's
declared symbols are always registered before files that reference them are
re-analysed.

```javascript
const tracker = new ScopeTracker({ enabled: true });

// lib.gml declares "utils"; app.gml references it.
tracker.enterScope("program", { path: "/lib.gml" });
tracker.declare("utils", {
    name: "utils",
    start: { line: 1, index: 0 },
    end: { line: 1, index: 5 }
});
tracker.enterScope("file", { path: "/app.gml" });
tracker.reference("utils", {
    name: "utils",
    start: { line: 3, index: 0 },
    end: { line: 3, index: 5 }
});
tracker.exitScope(); // app.gml
tracker.exitScope(); // lib.gml

const impacted = tracker.getImpactedFilePaths(["/lib.gml"]);
const sorted = tracker.sortPathsForReanalysis(impacted);
// Returns: ["/lib.gml", "/app.gml"]
// lib.gml must be re-analysed first because app.gml depends on it.
```

**Algorithm:** Uses Kahn's topological sort on a path-level dependency graph
derived from the current scope registrations. Paths with no dependencies on
other paths in the set are placed first (zero-in-degree first, then
lexicographic tie-break within each wave). Cycles are handled gracefully —
cycle members are appended in lexicographic order after all acyclic nodes.

**Important:** Call this method **before** `clearScopesForPath`. The sort reads
the current (potentially stale) scope graph to determine dependency order; once
scopes are cleared, that information is no longer available.

**Paths with no registered scopes** carry no dependency information and are
treated as independent — they appear at the front (zero-in-degree) in
lexicographic order alongside other independent paths.

---

### `clearScopesForPath(path)`

Removes all scopes (and their descendants) registered under the given file
path, cleaning up all internal indices.

```javascript
const cleared = tracker.clearScopesForPath("/lib.gml");
// Returns: number of scope objects removed
```

**Use case:** Third step in the hot-reload workflow. After computing the sorted
re-analysis order, call this for each path before re-parsing to ensure stale
scope data does not interfere with fresh analysis.

---

### Full Hot-Reload Example

```javascript
const tracker = new ScopeTracker({ enabled: true });

// Step 0 – initial parse registers all scopes.
// ... (parse lib.gml, app.gml, etc.)

// A file watcher reports that lib.gml changed.
const changedPaths = ["/lib.gml"];

// Step 1 – expand to all transitively impacted paths.
const impacted = tracker.getImpactedFilePaths(changedPaths);
// impacted: Set { "/lib.gml", "/app.gml" }

// Step 2 – sort BEFORE clearing (needs the live scope graph).
const sorted = tracker.sortPathsForReanalysis(impacted);
// sorted: ["/lib.gml", "/app.gml"]

// Step 3 – clear stale scopes in sorted order.
for (const p of sorted) {
    tracker.clearScopesForPath(p);
}

// Step 4 – re-parse each file in sorted order.
// parseAndRegisterScopes(tracker, sorted[0]);  // lib.gml first
// parseAndRegisterScopes(tracker, sorted[1]);  // app.gml second
```

## Identifier Case Bootstrap Controls

Formatter options that tune project discovery and cache behaviour now live in
the semantic layer. They continue to be part of the plugin’s public surface,
but their canonical documentation sits here alongside the implementation.

| Option                                       | Default                                                                                                                                                     | Summary                                                                                                                                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gmlIdentifierCaseDiscoverProject`           | `true`                                                                                                                                                      | Controls whether the formatter auto-discovers the nearest `.yyp` manifest to bootstrap the project index.                                                                         |
| `gmlIdentifierCaseProjectRoot`               | `""`                                                                                                                                                        | Pins project discovery to a specific directory when auto-detection is undesirable (e.g. CI or monorepos).                                                                         |
| `gmlIdentifierCaseProjectIndexCacheMaxBytes` | `8 MiB`                                                                                                                                                     | Upper bound for the persisted project-index cache. Set the option or `GML_PROJECT_INDEX_CACHE_MAX_SIZE` to `0` to disable the size guard when coordinating cache writes manually. |
| `gmlIdentifierCaseProjectIndexConcurrency`   | `4` (overridable via `GML_PROJECT_INDEX_CONCURRENCY`, clamped between `1` and the configured max; defaults to `16` via `GML_PROJECT_INDEX_MAX_CONCURRENCY`) | Caps how many GameMaker source files are parsed in parallel while building the identifier-case project index.                                                                     |

When rolling out rename scopes, continue to warm the project index cache
before enabling write mode so the semantic layer can reuse cached dependency
analysis. The bootstrap generates `.prettier-plugin-gml/project-index-cache.json`
the first time a rename-enabled scope executes; pin `gmlIdentifierCaseProjectRoot`
in CI builds to avoid repeated discovery work.

## Resource Metadata Extension Hook

> TODO: Remove this option/extension – handling custom resource metadata is out of scope. Keep this implementation 'opinionated'.

**Pre-change analysis.** The project index previously treated only `.yy`
resource documents as metadata, so integrations experimenting with alternate
GameMaker exports (for example, bespoke build pipelines that emit `.meta`
descriptors) had to fork the scanner whenever they wanted those files to be
indexed. The formatter’s defaults remain correct for the vast majority of
users, so the new seam keeps the behavior opinionated while allowing internal
callers to extend it on demand.

Use `setProjectResourceMetadataExtensions()` from the semantic project-index
package to register additional metadata suffixes. The helper normalizes and
deduplicates the list, seeds it with the default `.yy` entry, and is intended
for host integrations, tests, or future live tooling—not end-user
configuration. `resetProjectResourceMetadataExtensions()` restores the
defaults, and `getProjectResourceMetadataExtensions()` exposes the frozen list
for diagnostics. Production consumers should treat the defaults as canonical
until downstream formats stabilize; the hook exists to unblock experimentation
without diluting the formatter’s standard behavior.

## TODO

- Align the structure of `semantic` with the plan outlined in
  [../../docs/semantic-scope-plan.md](../../docs/semantic-scope-plan.md).
