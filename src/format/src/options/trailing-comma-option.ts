/**
 * GML does not support true trailing commas.
 *
 * A comma inside a call expression always represents a positional argument.
 * Writing `fn(a, b,)` does not mean “trailing comma” — it means there is an
 * additional argument after `b`. In GML, omitted arguments are represented
 * positionally (e.g. `fn(,,x)`), which evaluates to:
 *
 *     fn(undefined, undefined, x)
 *
 * Therefore, a trailing comma in arguments is not a formatting feature;
 * it changes arity and semantics by introducing an explicit `undefined`
 * argument slot. The {@link DEFAULT_CORE_OPTION_OVERRIDES} lock
 * `trailingComma` to {@link TRAILING_COMMA.NONE}; the `ALL` constant is
 * retained only because {@link shouldAllowTrailingComma} still references
 * it as a defensive equality check against user-supplied options.
 */
import type * as Prettier from "prettier";

type TrailingCommaOption = Prettier.RequiredOptions["trailingComma"];

const TRAILING_COMMA = Object.freeze({
    NONE: "none",
    ALL: "all"
} as const) satisfies Record<"NONE" | "ALL", TrailingCommaOption>;

export { TRAILING_COMMA };
