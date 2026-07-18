# @gmloop/lint

`@gmloop/lint` is the ESLint language plugin and rule bundle for GameMaker Language (`.gml`) in this monorepo.

It owns lint diagnostics and semantic/content rewrites (via lint rules and `--write`), while formatter-only layout behavior stays in `@gmloop/format`.

- Owns:
    - ESLint language wiring for GML (`language: "gml/gml"`)
    - Lint rules and single-file-safe autofix behavior. **Lint rule autofixes are responsible for fixing valid-but-forbidden syntax (e.g., style violations or deprecated patterns that are still syntactically valid).**
- Does not own:
    - Prettier formatting behavior (should not directly manipulate whitespace, semicolons, line breaks, indentation, etc.). **The formatter never repairs invalid syntax and only formats valid AST.** Should NOT depend on `@gmloop/format` or its internal APIs.
    - Parser internals/grammar ownership
    - Project-wide identifier indexing, rename safety, or hoist-name generation
    - Refactor transaction planning/execution. **Codemod/fixer commands are responsible for repairing non-parsable source text to restore parsability.**

See [../../docs/target-state.md](../../docs/target-state.md) for the split contract.

## Install and Peer Requirements

- Package: `@gmloop/lint`
- Peer dependency: `eslint` `>=9.39.0 <10`
- Runtime: Node `>=22`

## Quick Start (Flat Config)

```js
// eslint.config.js
import * as LintWorkspace from "@gmloop/lint";

export default [...LintWorkspace.Lint.configs.recommended];
```

This wires:

- `plugins.gml = Lint.plugin`
- `language = "gml/gml"`
- The curated recommended `gml/*` rule levels plus the conservative safe Feather subset
  (`gm1003`, `gm1009`, `gm1033`, `gm1041`, `gm1051`, `gm2007`, `gm2020`)

## Config Sets

`Lint.configs` exposes these immutable flat-config sets:

- `all`: every `gml/*` and `feather/*` rule at its recommended level
- `recommended`: the curated default `gml/*` rules plus a conservative safe `feather/*` subset
- `feather`: `feather/gm####` overlay rules from the feather manifest

Enable every lint rule with one config spread:

```js
import * as LintWorkspace from "@gmloop/lint";

export default [...LintWorkspace.Lint.configs.all];
```

The `all` config preserves each rule's recommended `"warn"` or `"error"` severity.

`gml/normalize-operator-aliases` is intentionally omitted from `recommended`. Enable it explicitly or use
`configs.all` when operator-alias diagnostics are desired.

## Language Behavior

The plugin registers `gml/gml` as an ESLint v9 language implementation and returns parser services under `parserServices.gml`:

- `schemaVersion`
- `filePath`
- `recovery`
- `directives`
- `enums`

Recovery mode is controlled by language options:

- `recovery: "limited"` (default)
- `recovery: "none"`

## Public API

The workspace exports a single namespace:

```ts
import * as LintWorkspace from "@gmloop/lint";

LintWorkspace.Lint;
```

`Lint` contains:

- `plugin`: ESLint plugin object for `gml/*` (`rules`, `languages`)
- `featherPlugin`: ESLint plugin object for `feather/*` (`rules`)
- `configs`: `all`, `recommended`, `feather`, `performance`
- `ruleIds`: PascalCase map keys to canonical full IDs (`gml/...`, `feather/...`)
- `services`: single-file-safe support values only; no project registries, project roots, or semantic indexes

## GML Rule IDs

Built-in `gml/*` rule short names:

- `prefer-hoistable-loop-accessors` (includes former `prefer-loop-length-hoist` scenarios)
- `prefer-loop-invariant-expressions`
- `prefer-struct-literal-assignments`
- `prefer-array-push`
- `prefer-compound-assignments`
- `prefer-increment-decrement-operators`
- `prefer-direct-return`
- `prefer-direct-boolean-return`
- `no-boolean-literal-comparisons`
- `optimize-logical-flow`
- `no-globalvar`
- `no-empty-regions`
- `no-scientific-notation`
- `no-unary-plus-on-identifier`
- `no-unnecessary-string-interpolation`
- `remove-default-comments`
- `remove-doc-function-tags`
- `normalize-banner-comments`
- `normalize-doc-comment-tags`
- `normalize-doc-comments`
- `normalize-doc-returns`
- `normalize-doc-param-defaults`
- `normalize-doc-param-separators`
- `normalize-doc-param-undefined-defaults`
- `normalize-directives`
- `normalize-block-keyword-aliases`
- `require-control-flow-braces`
- `require-region-pairs`
- `no-assignment-in-condition`
- `prefer-is-undefined-check`
- `prefer-epsilon-comparisons`
- `normalize-operator-aliases`
- `prefer-string-interpolation`
- `optimize-math-expressions`
- `require-argument-separators`
- `simplify-real-calls`

`prefer-compound-assignments` rewrites safe self-assignment forms
`x = x <op> y` to `x <op>= y` for arithmetic/bitwise operators that GML
actually supports in compound form, plus `??`. It never rewrites `x = x << y` or `x = x >> y`, because GML has no `<<=` or `>>=` operator.

`prefer-array-push` rewrites direct append assignments of the form
`array[array_length(array)] = value;` to `array_push(array, value);` when the
array receiver is side-effect-free and the replacement would stay within a
single standalone statement.

`prefer-increment-decrement-operators` rewrites standalone `+= 1` / `-= 1`
statements to `++` / `--` when the increment amount is a numeric literal equal to one. It intentionally skips `for` header update expressions and
comment-bearing statement spans.

`prefer-direct-return` rewrites adjacent local-return boilerplate from
`var value = expression; return value;` to `return expression;` when no comments would be dropped and the initializer does not reference the declared identifier.

`prefer-direct-boolean-return` rewrites boolean passthrough branches such as
`if (cond) return true; return false;` and `if (cond) return false; else return true;`
to direct boolean returns. It owns this focused fix instead of the broader
`optimize-logical-flow` rule.

`no-boolean-literal-comparisons` rewrites boolean literal comparisons such as
`ready == true`, `true == ready`, `ready != false`, `ready == false`, and
`ready != true` to the direct expression or its negation. It owns this focused
fix instead of the broader `optimize-logical-flow` rule.

`require-control-flow-braces` reports and autofixes unbraced control-flow statements by inserting structural `{ ... }` blocks. It does not depend on the formatter for that rewrite; the formatter remains responsible only for subsequent layout/canonical rendering.

`require-region-pairs` reports malformed `#region` / `#endregion` pairs. The autofix removes standalone `#endregion` directives and appends missing `#endregion` directives at the bottom of the file.

`prefer-struct-literal-assignments` only rewrites contiguous property assignments when they immediately follow an empty struct creation (`var foo = {};` or `foo = {};`). Property writes against existing structs are left unchanged.

`prefer-loop-invariant-expressions` hoists a single side-effect-free, loop-invariant expression into a cached `var` declared immediately before the loop. Equivalent occurrences inside the same loop reuse that single cache declaration, and later lint passes skip re-hoisting the synthetic `cached_*` initializers into ancestor loops. The rule is intentionally conservative: it checks the body and every loop-control expression for dependency mutations, does not move expressions across nested function, `with`, or exception-handling boundaries, and skips unknown calls, non-deterministic reads (for example `current_time`), dynamic DS/map accessors, and member/index reads that could be invalidated by loop-local mutations or impure calls.

`remove-default-comments` removes default GameMaker placeholder and migration-banner comments. If an object event file contains only those placeholder comments, the rule replaces them with `// Intentionally empty: overrides inherited/default object event behavior.` instead of making the file empty. Comment-only object events can be intentional in GameMaker because the event file can override inherited or default event behavior, such as disabling an automatic draw event.

`remove-doc-function-tags` removes legacy function marker lines such as `/// @function ...`, `/// @func ...`, `/// @funct ...`, and `/// @method ...` from documentation blocks while preserving neighboring doc metadata such as `@param`, `@returns`, `@override`, and custom tags.

`normalize-banner-comments` canonicalizes decorative banner comments (line and block forms) and rewrites method-list `///` banner lines (outside of function declarations) to plain `//` comments.

`normalize-doc-comment-tags` canonicalizes documentation comment markers and focused tag aliases, such as `// @param value` to `/// @param value`, `// / Summary` to `/// Summary`, `//// @func` to escaped `/// / @func`, `@arg`/`@argument`/`@params` to `@param`, `@return` to `@returns`, and `@private` to `@ignore`. It does not synthesize function docs or rewrite legacy function marker tags.

`normalize-doc-comments` canonicalizes function documentation blocks within a single file. It promotes leading doc text into descriptions and synthesizes missing tags for declaration/assignment-style function docs. When it rewrites a touched function-doc block, it consumes the same focused tag-alias canonicalization as `normalize-doc-comment-tags` so broad function-doc fixes do not reintroduce stale aliases. Constructors, including for inherited constructors (`function X(...) : Parent(...) constructor`). For struct/object literal property functions, the rule synthesizes docs, including `@returns`. Canonical ordering keeps non-param metadata tags before the param block, but preserves custom tags interleaved between `@param` lines when intentionally authored that way.

`normalize-doc-returns` converts legacy return description lines into canonical `@returns` metadata (for example, `Returns: Boolean, indicating success` to `@returns {Boolean} Indicating success`).

`normalize-doc-param-defaults` owns optional `@param` default cleanup when the default text cannot be represented safely on one doc-comment line. For example, when synthesized docs would otherwise include a multiline default expression, it collapses that tag to a default-free optional parameter such as `/// @param [matrix]`.

`normalize-doc-param-separators` removes legacy `@param` separator hyphens in doc comments (for example, `@param value - desc` to `@param value desc`).

`normalize-doc-param-undefined-defaults` removes explicit `undefined` defaults from optional `@param` names (for example, `@param [value=undefined]` to `@param [value]`).

`normalize-operator-aliases` is intentionally syntax-safety scoped: it repairs invalid `not` operator usage to `!` in executable code (while skipping uses in comments, string literals, and user-defined identifiers like `not(value)` or `#macro not 1`), and avoids style rewrites. Since logical `not` is strictly rejected by the GML parser, the linter's pre-parser recovery maps invalid logical `not`/`NOT` to `!  ` (preserving source offsets) so that the file remains parseable for this rule to diagnose and permanently fix it.
Logical operator style normalization (`&&`/`||`/`^^` vs `and`/`or`/`xor`) belongs to the formatter (`@gmloop/format`, `logicalOperatorsStyle`), so lint does not rewrite those forms.

`optimize-logical-flow` simplifies logical expressions and conditional assignment branches. Boolean literal comparisons are owned by `no-boolean-literal-comparisons`. Direct boolean return passthroughs are owned by `prefer-direct-boolean-return`. Nullish guard assignments (`if (is_undefined(x)) x = y;` / `if (x == undefined) x = y;`) are owned by `feather/gm2061`, because they correspond to Feather's official nullish-coalescing diagnostic. Comment-bearing ranges are intentionally skipped so autofixes never strip authored comments while optimizing nearby comment-free logic.
`optimize-logical-flow` and `optimize-math-expressions` clone candidate AST fragments using a traversal-link-stripping helper (skipping `parent`/context pointers) so autofix performance remains stable on very large scripts.
`prefer-loop-invariant-expressions` memoizes subtree hoistability checks per loop, caches normalized in-scope identifier names across loop iterations, reuses a single replacement target set for equivalent invariant expressions, and uses indexed comment-token range checks so large loop-heavy files avoid repeated full-source rescans.
`optimize-math-expressions` only performs reciprocal-term cancellation on side-effect-free operands (identifiers/member accesses/literals). Call-expression operands are intentionally excluded from that cancellation path.
`simplify-real-calls` detects calls to GML's built-in `real()` function that take a single string literal argument whose content is a valid numeric literal, and replaces the entire call expression with just the numeric literal. E.g. `real("0.5")` → `0.5`. This rewrite is safe because `real()` with a string literal argument is deterministic and has no observable side effects.

Feather rules are exposed as `feather/gm####` and sourced from `Lint.services.featherManifest`. All feather-namespace lint rules follow the naming pattern `feather/gm####`, where the lint rule diagnoses and fixes only the issue for the associated Feather rule/diagnostic. For example, lint rule `feather/gm1000` identifies and fixes the specific issue described in Feather rule `gm1000`: "No enclosing loop from which to break." This creates a clear, traceable link between each Feather rule and its corresponding lint rule, and allows new lint rules for new Feather rules to be added through the manifest.

`feather/gm1010` uses a conservative numeric-casting strategy: it only wraps `num*` identifiers with `real(...)` when they are directly added to a numeric literal (for example, `5 + numFive`), and leaves mixed string-concatenation chains untouched.

Migrated Feather ownership is split by diagnostic category: `feather/gm1017`
handles deprecated callable APIs, `feather/gm1023` deprecated constants,
`feather/gm1024` deprecated built-in variables, `feather/gm1028`
data-structure accessor correction, `feather/gm1056` trailing optional
parameter defaults, and `feather/gm2004` safe unused-index `for` to `repeat`
conversion. These rules retain scoped AST checks and only expose local fixes
that can be proven safe.

When a safe, single-file `gml/*` fix overlaps an official Feather diagnostic,
the Feather rule owns that exact autofix. The overlapping `gml/*` rule may keep
fixes for behavior outside the Feather diagnostic, but must not also fix the
same diagnostic-owned span.

Ownership cleanup must preserve existing safe fixes. If purifying a Feather
rule would otherwise remove safe local behavior, split that behavior into a
smaller canonical rule, usually a focused `gml/*` rule when there is no matching
Feather diagnostic.

Before adding a new rule or fixer, check `Lint.services.featherManifest` and
the Feather metadata catalog for an unimplemented `GM####` diagnostic that
already owns the behavior or could own a safe local fixer. Implement that
metadata-correct Feather ID before introducing a new `gml/*` rule.

Reset-state ownership follows the same diagnostic boundary. `feather/gm2049`
owns `gpu_set_zfunc(cmpfunc_lessequal)`, `feather/gm2062` owns
`draw_set_colour(c_white)`, and `feather/gm2063` owns `draw_set_alpha(1)`.
The z-write and z-test resets have no metadata-correct Feather diagnostic, so
they are implemented as focused GML rules:
`gml/require-zwrite-enabled-reset` and `gml/require-ztest-enabled-reset`.

Fixture suites may compose multiple lint rules in their local `gmloop.json`
when a golden output represents more than one domain-correct fix. A Feather
fixture should not keep a fixer assigned to the wrong GM diagnostic solely to
preserve historical output; compose the canonical rule instead, or make the
Feather expectation report-only when no domain-correct fixer exists.

## Development

```bash
pnpm --filter @gmloop/lint run build:types
pnpm --filter @gmloop/lint run test
```

Performance-sensitive autofix rules also have dedicated regression coverage under [`test/rules/optimized-autofix-performance.test.ts`](test/rules/optimized-autofix-performance.test.ts). Those tests run as part of the normal compiled Node test suite, so CI enforces both fix correctness and the current runtime budgets for the measured hot paths.

## TODO

- Add an ESLint auto-fix rule that detects simple numeric accumulation loops like `alpha += index` over a fixed range and replaces them with the equivalent arithmetic-series expression. Example: `for index = 0..9` can become `alpha += count * (count - 1) * 0.5`, avoiding unnecessary runtime iteration.
- Continue splitting the remaining multi-purpose `optimize-logical-flow` behaviors into focused rules; direct boolean return passthroughs and boolean literal comparisons now live in focused rules.
- **BUG**: Lint auto-fix(es) related to doc-comments can produce invalid/duplicate params, ex.:
    ```gml
    -/// @function scr_timeline_play
    -/// @param {Resource.GMTimeline} timeline_to_play - A timeline asset index
    +/// @param {Resource.GMTimeline} timeline_to_play A timeline asset index
    /// @param {Function} *func_callback - A function to call after the timeline has completed
    +/// @param func_callback
    /// @returns {obj} timeline_controller
    function scr_timeline_play(timeline_to_play, func_callback) { /* ... */ }
    ```
- **BUG**: Lint auto-fixes introduce this break in GML code:
  ```
  -			global.camPos[global.camTransform[1, 0]] += global.mouseDx / 2;
  -			global.camPos[global.camTransform[1, 1]] += global.mouseDy / 2;
  +			global.camPos[global.camTransform[#, 0]] += global.mouseDx * 0.5;
  +			global.camPos[global.camTransform[#, 1]] += global.mouseDy * 0.5;
  ```
  Anther example:
  ```
  -		global.camPos[global.camTransform[1, 0]] -= 5 * (keyboard_check(vk_right) - keyboard_check(vk_left));
  -		global.camPos[global.camTransform[1, 1]] -= 5 * (keyboard_check(vk_down) - keyboard_check(vk_up));
  +		global.camPos[global.camTransform[#, 0]] -= 5 * (keyboard_check(vk_right) - keyboard_check(vk_left));
  +		global.camPos[global.camTransform[#, 1]] -= 5 * (keyboard_check(vk_down) - keyboard_check(vk_up));
  ```
  And this other example:
  ```
  -			if global.mouseViewInd == 3{global.camPos[global.camTransform[global.mouseViewInd, 0]] += global.mouseDx * global.camZoom;}
  -			else{global.camPos[global.camTransform[global.mouseViewInd, 0]] -= global.mouseDx * global.camZoom;}
  -			if global.mouseViewInd == 2{global.camPos[global.camTransform[global.mouseViewInd, 1]] -= global.mouseDy * global.camZoom;}
  -			else{global.camPos[global.camTransform[global.mouseViewInd, 1]] += global.mouseDy * global.camZoom;}
  +			if global.mouseViewInd == 3{global.camPos[global.camTransform[#lobal.mouseViewInd, 0]] += global.mouseDx * global.camZoom;}
  +			else{global.camPos[global.camTransform[#lobal.mouseViewInd, 0]] -= global.mouseDx * global.camZoom;}
  +			if global.mouseViewInd == 2{global.camPos[global.camTransform[#lobal.mouseViewInd, 1]] -= global.mouseDy * global.camZoom;}
  +			else{global.camPos[global.camTransform[#lobal.mouseViewInd, 1]] += global.mouseDy * global.camZoom;}
  ```
- **FEAT**: A lint fixer to convert legacy 2D array accessors (e.g. `my_array[1, 2]`) to the array convention of `my_array[1][2]` when the array is known to be a 2D array
- **BUG**: Lint auto-fix is producing this changed GML (`dot_product_3d` can be negative):
  ```
   	    var dn = dot_product_3d(vx, vy, vz, nx, ny, nz);
  -	    if (dn == 0)
  +	    var eps = math_get_epsilon();
  +	    if (dn <= eps)
  ```
  It also does *not* need to change this, as `if (l > 0)` is already safe:
  ```
   	    var l = sqrt(toX * toX + toY * toY + toZ * toZ);
    -	if (l > 0)
    +	if (l > math_get_epsilon())
  ```
- **FEAT**: I think this codemods "repairDependentVariableDeclarations" should become a lint auto-fix, not a codemod. The 'dependentVariableDeclarations' *are* valid GML code, using them is a user preference (and also needed for html5 compatibility). Should be called "**no-multi-var-declarations**":
  ```
  var a = 1,
      b = 2;
  ```
  becomes:
  ```
  var a = 1;
  var b = 2;
  ```
