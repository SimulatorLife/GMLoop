# Architectural Audit: CLI Refactor Bridge Dependencies

## Design Rationale

The PR-comment audit reviewed the repository for modules that import peers
using deep relative paths (`"../.." or deeper`) or paths containing
`"/internal/"` segments. After a repository-wide survey:

- No source-file imports reach beyond `../../` (only test files do, which is
  expected when tests exercise internals).
- No source-file path contains an `/internal/` segment; no file or directory is
  named with the `internal` prefix.
- Cross-workspace imports already use the `@gmloop/<workspace>` package name
  rather than deep relative paths.

The remaining coupling risk identified was inside the `@gmloop/cli` workspace:
two separate modules were instantiating the concrete parser and transpiler
classes (`new Parser.GMLParser(...)` and `new Transpiler.GmlTranspiler(...)`)
through parallel code paths. The two paths had drifted in subtle ways (one
omitted `sllPredictionMaxSourceLength`, the other set `getComments: false`),
which is exactly the divergence that the existing
`docs/target-state.md` dependency-inversion guidance is meant to prevent.

## Survey Findings

- `src/cli/src/modules/transpilation/adapters.ts` already exposed a canonical
  factory seam (`createGmlParserAdapter` / `createGmlTranspilerAdapter`) used
  by the transpilation coordinator, watch command, and the transpile command.
  That module documents itself as the dependency-inversion seam over the
  parser/transpiler workspaces.
- `src/cli/src/modules/refactor/bridge-dependencies.ts` re-implemented the same
  factories by directly importing `@gmloop/parser` and `@gmloop/transpiler` and
  calling `new Parser.GMLParser(...)` / `new Transpiler.GmlTranspiler()`
  inline. The duplication meant the refactor engine had its own private
  concrete-instantiation path that bypassed the canonical adapter module.

The coupling was risky because any change to parser/transpiler wiring (such as
updating the default options, swapping in a preprocessor, or adding telemetry)
had to be applied in two places, with no compile-time guarantee that the two
paths stayed in sync. Tests could pass against one path while the other drifted
silently.

## Migration and Fallback Plan

The migration replaced the inline `new` expressions in
`src/cli/src/modules/refactor/bridge-dependencies.ts` with delegated calls to
the canonical adapter factories from
`src/cli/src/modules/transpilation/adapters.ts`. A new
`REFACTOR_BRIDGE_PARSER_OPTIONS` constant pins the exact parser options the
refactor engine relied on previously so behaviour parity is preserved.

If a regression appeared, the fallback would be to revert the single file;
no public API migration or compatibility shim would be required because the
refactor engine's public surface (`createRefactorBridges`,
`GmlParserBridge`, `GmlTranspilerBridge`, `GmlSemanticBridge`) is unchanged.
The bridge-dependencies module remains an internal CLI seam.

## Before and After

### Before

`src/cli/src/modules/refactor/bridge-dependencies.ts` directly imported the
parser and transpiler workspaces and instantiated their concrete classes
inline:

- `import { Parser } from "@gmloop/parser";`
- `import { Transpiler } from "@gmloop/transpiler";`
- `const gmlParser = new Parser.GMLParser(source, { getLocations: true, simplifyLocations: true });`
- `return new Transpiler.GmlTranspiler();`

### After

`src/cli/src/modules/refactor/bridge-dependencies.ts` delegates to the
canonical CLI adapter factories, with a named constant pinning the
configuration that the refactor engine relies on:

- Imports the canonical factories from
  `src/cli/src/modules/transpilation/adapters.ts`.
- Stores the parser options in a frozen `REFACTOR_BRIDGE_PARSER_OPTIONS`
  constant so the configuration is auditable from one location.
- Calls `createCanonicalGmlParserAdapter(REFACTOR_BRIDGE_PARSER_OPTIONS)` and
  `createCanonicalGmlTranspilerAdapter()` to produce the bridge dependencies.

The refactor layer no longer reaches into `@gmloop/parser` or
`@gmloop/transpiler` directly; it depends on the CLI workspace's existing
adapter abstraction instead. The single source of truth for adapter
instantiation is now `src/cli/src/modules/transpilation/adapters.ts`.

## Behaviour and API Stability

- Public CLI commands, workspace package exports, and bridge contracts are
  unchanged. `createRefactorBridges`, `GmlParserBridge`, `GmlTranspilerBridge`,
  and `GmlSemanticBridge` all keep their existing signatures.
- The refactor bridge's parser adapter still receives the same effective
  parser configuration (`getComments: true`, `getLocations: true`,
  `simplifyLocations: true`, `attachFunctionDocComments: true`,
  `sllPredictionMaxSourceLength: 8000`, `astFormat: "gml"`, `asJSON: false`)
  via `REFACTOR_BRIDGE_PARSER_OPTIONS`.
- The transpiler adapter is constructed through the canonical factory with
  no upstream dependencies, matching the prior `new Transpiler.GmlTranspiler()`
  behaviour.
- No generated files, `dist` files, submodules, or golden `.gml` fixtures were
  modified.
- Existing test suites (`pnpm run build:ts`, `pnpm run lint:quiet`, the full
  `@gmloop/cli` and `@gmloop/refactor` test suites) all pass without
  regressions.