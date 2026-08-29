/**
 * Canonical catalogue of supported live-reload bootstrap log levels.
 *
 * The browser bootstrap entrypoint previously branched on raw string literals
 * (`if (logLevel === "quiet") return;`) inside {@link writeBootstrapLog}, and
 * silently fell through to the documented "normal" behaviour for any other
 * value — including typos, look-alike strings such as `"info"` or
 * `"warning"`, and even empty strings. That meant a typo in a deployment
 * config could not be detected at runtime; the log level was simply treated
 * as if it were `"normal"`.
 *
 * This module replaces those ad-hoc comparisons with a typed catalogue that:
 *
 *   - declares the canonical frozen object of supported level values
 *     ({@link LIVE_RELOAD_LOG_LEVELS}),
 *   - derives the union type ({@link LiveReloadLogLevel}) directly from that
 *     object so the compile-time and runtime views cannot drift apart,
 *   - exposes a fast `ReadonlySet` membership check
 *     ({@link LIVE_RELOAD_LOG_LEVEL_VALUES}),
 *   - provides a type guard ({@link isLiveReloadLogLevel}) and a parser
 *     ({@link parseLiveReloadLogLevel}) so call sites can validate untrusted
 *     input without bespoke string matching, and
 *   - lets {@link writeBootstrapLog} use an exhaustive switch with a default
 *     branch so unknown values fail fast with a descriptive error instead of
 *     silently defaulting to `"normal"`.
 */

/**
 * Canonical frozen object of supported live-reload bootstrap log levels.
 *
 * The `as const satisfies Record<string, LiveReloadLogLevel>` annotation
 * preserves the literal types so the derived union
 * ({@link LiveReloadLogLevel}) is built directly from these entries; the
 * `satisfies` clause then guarantees that every declared key resolves to a
 * valid level. Adding a new level is therefore a single edit here.
 */
export const LIVE_RELOAD_LOG_LEVELS = Object.freeze({
    QUIET: "quiet",
    NORMAL: "normal",
    DEBUG: "debug"
} as const);

/**
 * User-selectable log level for the live-rereload browser bootstrap.
 *
 * Derived from {@link LIVE_RELOAD_LOG_LEVELS} so introducing a new level is a
 * one-line change in the frozen object — TypeScript will then flag every
 * `switch`/`if` covering this union at build time.
 */
export type LiveReloadLogLevel = (typeof LIVE_RELOAD_LOG_LEVELS)[keyof typeof LIVE_RELOAD_LOG_LEVELS];

/**
 * Set form of {@link LIVE_RELOAD_LOG_LEVELS} for O(1) membership checks.
 *
 * Derived from the frozen object so that introducing a new level automatically
 * updates the membership set without any chance of drift between the two.
 */
export const LIVE_RELOAD_LOG_LEVEL_VALUES: ReadonlySet<LiveReloadLogLevel> = new Set(
    Object.values(LIVE_RELOAD_LOG_LEVELS)
);

/**
 * Render a comma-separated list of every valid {@link LiveReloadLogLevel}.
 *
 * Used by the parser's error message so the allowed set stays in sync with
 * {@link LIVE_RELOAD_LOG_LEVELS} automatically.
 */
function listLiveReloadLogLevels(): string {
    return Object.values(LIVE_RELOAD_LOG_LEVELS).join(", ");
}

/**
 * Type guard that narrows an arbitrary value to a {@link LiveReloadLogLevel}.
 *
 * Returns a type guard (rather than throwing) so call sites can decide how to
 * react to invalid input — typically by falling back to a default — without
 * wrapping each validation in a `try`/`catch`.
 */
export function isLiveReloadLogLevel(value: unknown): value is LiveReloadLogLevel {
    return typeof value === "string" && LIVE_RELOAD_LOG_LEVEL_VALUES.has(value as LiveReloadLogLevel);
}

/**
 * Validate a raw string (typically read from a deployment-specific bootstrap
 * config asset) and return a {@link LiveReloadLogLevel}, or `null` when the
 * string is not one of the supported level values.
 *
 * Centralising the parse here means raw literal comparisons can never drift
 * from the canonical level list — adding `"verbose"` to
 * {@link LIVE_RELOAD_LOG_LEVELS} is enough to make the new value flow through
 * every call site automatically.
 */
export function parseLiveReloadLogLevel(value: unknown): LiveReloadLogLevel | null {
    return isLiveReloadLogLevel(value) ? value : null;
}

/**
 * Coerce an arbitrary value into a {@link LiveReloadLogLevel}.
 *
 * Throws an `Error` with a descriptive message when the value is not a
 * string or is a string that does not match one of the canonical level
 * values. Use this helper at trust boundaries (e.g. the bootstrap config
 * reader) where an invalid value should fail fast; use
 * {@link parseLiveReloadLogLevel} when the caller wants to fall back to a
 * default instead.
 *
 * @param value - Raw value supplied by the bootstrap config reader or a test.
 * @returns The canonical {@link LiveReloadLogLevel} value.
 */
export function coerceLiveReloadLogLevel(value: unknown): LiveReloadLogLevel {
    const candidate = parseLiveReloadLogLevel(value);
    if (candidate !== null) {
        return candidate;
    }

    throw new Error(
        `Invalid live-reload bootstrap log level: ${JSON.stringify(value)}. Expected one of: ${listLiveReloadLogLevels()}.`
    );
}
