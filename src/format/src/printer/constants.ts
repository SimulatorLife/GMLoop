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
 * Minimum number of consecutive variable declarations required before inserting
 * blank-line padding before a loop statement.
 *
 * This threshold controls when the formatter inserts a blank line between a
 * block of variable declarations and the following loop (for/while/repeat/do-until/with).
 * For example, with a threshold of 4, the formatter adds blank lines only when
 * there are 4 or more consecutive `var` statements immediately before the loop.
 *
 * This value can be overridden via the `variableDeclarationsBeforeLoopPadding`
 * formatter option in `.prettierrc` or `gmloop.json`.
 */
export const DEFAULT_VARIABLE_DECLARATIONS_BEFORE_LOOP_PADDING = 4;

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
    "ExitStatement",
    "ExpressionStatement",
    "CallExpression"
]);

export const MULTIPLICATIVE_BINARY_OPERATORS = new Set(["*", "/", "div", "%", "mod"]);

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
