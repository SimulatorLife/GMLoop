# @gmloop/format

This directory contains the source code for the [gml-modules/format](https://github.com/gml-modules/format) package.

## Test Tiering

- Format fixture/unit tests validate formatter-owned layout behavior.
- Project-aware behavior is validated in lint/CLI test suites; format tests do not validate semantic rewrite behavior.

## Format Architecture

### Constants ([`src/printer/constants.ts`](src/printer/constants.ts))

The format workspace uses a centralized constants file to define formatting defaults and thresholds. This ensures consistency across the codebase and makes it easy to understand and maintain default values.

Key constants include:

- `DEFAULT_PRINT_WIDTH` (120): The default line width for code
- `DEFAULT_TAB_WIDTH` (4): The default indentation width

These constants are used throughout the format workspace to ensure consistent behavior. Users can override formatting defaults through Prettier's standard options (e.g., `printWidth`, `tabWidth`).

## Formatting Conventions

- Prettier always formats functions with a space before the parameter list `function (o) {}`, but never for function calls `fn(o)`. This behavior is fixed and not configurable. For a function name and its parameter list (e.g. `function foo(x) {}`) Prettier does NOT add a space. The formatter uses the same style convention.
- Comments are never broken up or reflowed to fit the `printWidth` setting. This aligns with Prettier's default behavior for comments, preserving the developer's original line structure and preventing unintended corruption of commented-out code or manual formatting.
- The formatter does not introduce additional line breaks or blank lines beyond what Prettier's core engine generates based on the document shape and `printWidth`. This means that struct literals, argument lists, and other constructs will wrap according to Prettier's standard rules without custom thresholds for the number of properties or parameters per line.
- Like Prettier, this formatter _does_ remove redundant parentheses, but it does not add new ones for readability. For example, expressions like `a + (b * c)` are formatted as `a + b * c`. Prettier is opinionated about layout and minimal syntax, but it avoids adding new structural elements like parentheses because that crosses from formatting into rewriting the code’s AST.
- The formatter requires a valid parse; if parse fails, it should error and **not** change files. It should never produce partial or best-effort output on an invalid parse, and it should not attempt to salvage or reformat code when the input is syntactically incorrect

## Deprecated And Removed Options

- `maxStructPropertiesPerLine` was removed on February 7, 2026.
- Why it was removed: struct layout is now fully opinionated and consistent with Prettier defaults, so struct wrapping is controlled by document shape and `printWidth` rather than a custom numeric threshold.
- Migration: remove `maxStructPropertiesPerLine` from configuration files; no replacement option is provided.
- `maxParamsPerLine` was removed on February 7, 2026.
- Why it was removed: argument layout now follows Prettier-style default wrapping with `printWidth` and document shape, without numeric argument-count thresholds.
- Migration: remove `maxParamsPerLine` from configuration files; no replacement option is provided.

## Formatter/Linter/Refactor Ownership Boundaries

The format workspace owns formatting and parser-to-printer orchestration _only_ (semicolons, whitespaces, line breaks, indentation, etc.).

- `@gmloop/format` is formatter-only.
- Any file-scoped semantic/content rewrites belongs to `@gmloop/lint` rules and is applied via `lint --write`. project-aware transformations and rewrites (e.g. function doc-comment generation/fixing, legacy annotation normalization, `globalvar` rewrite) are the responsibility of the `@gmloop/refactor` module, which is a 'codemod' module.
- This Prettier formatter workspace **must not** depend directly on `@gmloop/semantic`, `@gmloop/refactor`, or `@gmloop/lint`.
- Semantic/content rewrites, project-aware transformations, and 'fixes' (fixing/generating function doc-comments, transforming legacy `globalvar` declarations to use the `global` keyword, etc.) are lint auto-fix responsibilities in `@gmloop/lint`.

Formatter doc-comment boundary guarantees:

- Legacy annotations such as `/// @function ...` are preserved by the formatter and are never replaced/normalized.
- The formatter never synthesizes `/// @description`, `/// @param`, `/// @returns`, or other function doc-comment tags.
- The formatter preserves explicitly-authored function parameter defaults, including `= undefined`, and never infers/removes optional defaults from doc-comment semantics.
- The formatter does not remove default/placeholder comments (for example, GameMaker migration banners or editor placeholder comments); this is lint-owned via `gml/remove-default-comments`.

See the durable split contract and examples in [`docs/target-state.md`](../../docs/target-state.md).
