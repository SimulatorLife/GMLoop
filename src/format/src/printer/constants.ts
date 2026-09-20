/**
 * Centralized constants for the GML formatter printer(s).
 *
 * This module consolidates configuration defaults and magic numbers used across
 * the formatter implementation. By centralizing these values, we:
 * - Ensure consistency across different parts of the formatter
 * - Make it easier to maintain and update defaults
 * - Provide a single source of truth for configuration values
 * - Enable clearer understanding of formatting behavior
 *
 * Constants here focus on non-language concerns like formatting parameters,
 * thresholds, and limits. Language syntax and semantics are defined by GameMaker
 * and should not be made configurable.
 */

/**
 * Default print width for GML code and documentation comments.
 *
 * This value represents the preferred line length in characters. The formatter
 * will attempt to wrap lines that exceed this width, though it may produce
 * longer lines when necessary to preserve code structure or readability.
 *
 * 120 characters is chosen as a reasonable default that:
 * - Accommodates modern wide displays
 * - Balances readability with information density
 * - Aligns with common GameMaker code conventions
 * - Works well with typical IDE and editor configurations
 */
export const DEFAULT_PRINT_WIDTH = 120;

/**
 * Default tab width for indentation.
 *
 * GameMaker Language conventionally uses 4-space indentation, which this
 * formatter respects as the default. Users can override this via Prettier's
 * standard `tabWidth` option.
 */
export const DEFAULT_TAB_WIDTH = 4;

/**
 * Pattern for validating numeric literal strings, including optional sign and
 * exponent parts. Anchored with the `u` flag to prevent unsafe regex warnings
 * from ESLint's `security/detect-unsafe-regex` rule.
 */
export const NUMERIC_STRING_LITERAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u;

/**
 * Set of AST node types that can be safely inlined when they are the sole statement in a block.
 */
export const INLINEABLE_SINGLE_STATEMENT_TYPES = new Set([
    "ReturnStatement",
    "BreakStatement",
    "ContinueStatement",
    "ExitStatement",
    "ExpressionStatement",
    "CallExpression"
]);

export const MULTIPLICATIVE_BINARY_OPERATORS = new Set(["*", "/", "div", "%", "mod"]);

/**
 * Layout overhead (in characters) used by `shouldInlineClauseByPrintWidth` to
 * estimate the on-disk length of an inline control-flow block such as
 * `if (cond) { body; }`. The total overhead is the sum of the prefix, the
 * middle (between clause and body), and the suffix. The constants are derived
 * directly from the doc produced by `printSingleClauseStatement` (search for
 * the matching `" ("`, `") {"`, and `" }"` strings there) so the estimator
 * stays in lockstep with the actual output as the printer evolves.
 *
 * Keep these in sync with the doc fragments in
 * `src/format/src/printer/single-clause-statement.ts` (the `group([...])` call
 * inside `printSingleClauseStatement`).
 */
export const INLINE_BLOCK_PREFIX_OVERHEAD = " (".length;
export const INLINE_BLOCK_MIDDLE_OVERHEAD = ") { ".length;
export const INLINE_BLOCK_SUFFIX_OVERHEAD = " }".length;

/**
 * Sum of the three inline-block layout overhead constants. Pre-computed so
 * the inline-length estimator in `shouldInlineClauseByPrintWidth` can add a
 * single value to the clause and body source-text lengths.
 */
export const INLINE_BLOCK_TOTAL_OVERHEAD =
    INLINE_BLOCK_PREFIX_OVERHEAD + INLINE_BLOCK_MIDDLE_OVERHEAD + INLINE_BLOCK_SUFFIX_OVERHEAD;

/**
 * Default fallback value for the `inlineControlFlowBlockMargin` formatter
 * option. Used when the option is missing from the Prettier options bag,
 * is not a finite number, or is otherwise unusable.
 *
 * Centralising the value here keeps the printer fallback, the
 * `default-format-components` plugin defaults, and the
 * `project-config-catalog` documentation entry in lockstep so the catalog
 * entry, the resolved plugin default, and the runtime fallback can never
 * silently drift apart.
 */
export const DEFAULT_INLINE_CONTROL_FLOW_BLOCK_MARGIN = 0;

/**
 * Minimum number of contiguous top-level variable declarations that must
 * precede a loop before the formatter inserts an extra blank-line padding
 * between the variable block and the loop. Smaller variable blocks keep
 * the source's natural spacing; larger blocks receive a visual separator
 * to make the loop's entry point easier to scan.
 *
 * The value is exposed as the `minVariablesBeforeLoopPadding` formatter
 * option so projects with different house styles can tune the heuristic
 * without forking the printer.
 */
export const MIN_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING = 4;

// String constants to avoid duplication warnings
export const STRING_TYPE = "string";
export const OBJECT_TYPE = "object";
export const NUMBER_TYPE = "number";
export const UNDEFINED_TYPE = "undefined";

/**
 * Property key used to track whether a node's doc comment block has already
 * been emitted. Set to `true` on the AST node after doc comments are printed
 * so downstream logic (e.g. trailing-spacing decisions) can query it without
 * re-examining the doc comment array.
 */
export const DOC_COMMENT_OUTPUT_FLAG = "_gmlHasDocCommentOutput";
