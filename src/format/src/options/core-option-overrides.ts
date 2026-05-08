/**
 * @gmloop/format
 *
 * Prettier core options include many knobs that are either:
 * 1) Invalid for GML (would generate non-GML syntax or change semantics)
 * 2) Irrelevant for GML (JSX/HTML/prose options; no effect on GML printers)
 * 3) Prettier-compat shims (options that exist in core configs but do not map
 *    to any GML syntax feature)
 *
 * This module provides the canonical frozen Prettier-core option overrides for
 * the GML formatter with a strict contract:
 *
 * - "forced" options are hard-locked to a single safe value regardless of user
 *   config (e.g. trailing commas).
 * - "noop" options are accepted for config compatibility but are always locked
 *   to their default because they have no meaning in GML output (e.g. arrowParens).
 * - "irrelevant" options are also locked to default because they apply to other
 *   languages (JSX/HTML/prose) and should never influence GML output.
 */

import { TRAILING_COMMA } from "./trailing-comma-option.js";

type TrailingCommaOption = (typeof TRAILING_COMMA)[keyof typeof TRAILING_COMMA];

/**
 * Complete Prettier-core option overrides applied unconditionally for GML.
 * All values are locked; no user-provided values are accepted or normalised.
 */
export type CoreOptionOverrides = Readonly<{
    trailingComma: TrailingCommaOption;
    arrowParens: "always" | "avoid";
    singleAttributePerLine: boolean;
    jsxSingleQuote: boolean;
    proseWrap: "always" | "never" | "preserve";
    htmlWhitespaceSensitivity: "css" | "strict" | "ignore";
}>;

/**
 * Hard overrides for GML regardless of incoming config.
 *
 * - `trailingComma` is forced to "none" because commas in GML argument lists are
 *   positional: `fn(a, b,)` implies an extra slot, and `fn(,,x)` corresponds to
 *   `fn(undefined, undefined, x)`.
 * - `arrowParens` is a Prettier-compat option with no GML meaning; locked to
 *   "always" to avoid implying configurability.
 * - JSX/HTML/prose options are kept to satisfy hosts that forward shared Prettier
 *   configs without generating warnings.
 */
export const DEFAULT_CORE_OPTION_OVERRIDES: CoreOptionOverrides = Object.freeze({
    trailingComma: TRAILING_COMMA.NONE,
    arrowParens: "always",
    singleAttributePerLine: false,
    jsxSingleQuote: false,
    proseWrap: "preserve",
    htmlWhitespaceSensitivity: "css"
});

/**
 * Resolve the effective Prettier core option overrides for the current run.
 *
 * Returns the locked default map unconditionally. All option values are fixed;
 * user-provided values are silently ignored to prevent non-GML output or
 * misleading configurability.
 */
export function resolveCoreOptionOverrides(): CoreOptionOverrides {
    return DEFAULT_CORE_OPTION_OVERRIDES;
}
