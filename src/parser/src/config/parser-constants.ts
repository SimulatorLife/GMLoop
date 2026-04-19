/**
 * Parser prediction strategy defaults.
 *
 * The SLL fast path is significantly faster for small/medium inputs but can
 * trigger expensive fallback behavior on very large sources. This threshold lets
 * callers tune the SLL/LL hand-off to match project size characteristics.
 */
export const DEFAULT_SLL_PREDICTION_MAX_SOURCE_LENGTH = 8000;
