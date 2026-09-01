/**
 * Interactive progress bars for long-running CLI commands.
 *
 * The CLI renders `Label [████░░] current/total` lines by reusing a single
 * progress instance per label so that a series of incremental updates
 * re-prints the same source row (via `\r` + ANSI clear-line) instead of
 * flooding stdout with one line per tick. The module owns the registry of
 * active bars and the width that drives their fill ratio, and is therefore
 * the single source of truth for "is a progress bar visible right now?".
 *
 * Why it is structured this way:
 * - Rendering is suppressed on non-TTY streams because carriage-return-based
 *   redraws would corrupt logs that are redirected to a file or piped into
 *   another command. The {@link ProgressBarStream.isTTY} flag is the gate.
 * - The cursor is hidden while a bar is on screen and restored on
 *   {@link TerminalProgressBar.stop}; this prevents flicker on terminals
 *   that repaint the cursor between writes.
 * - The width is environment-driven (`GML_PROGRESS_BAR_WIDTH`) so a wrapper
 *   script can resize bars without touching the source. A width of `0` is
 *   treated as "rendering disabled" rather than an error so callers can
 *   also opt out via configuration.
 *
 * @example
 * ```ts
 * import { renderProgressBar, withProgressBarCleanup } from "./progress-bar.js";
 *
 * await withProgressBarCleanup(async () => {
 *     for (let i = 0; i <= total; i += 1) {
 *         await step();
 *         renderProgressBar("Checking", i, total, 24);
 *     }
 * });
 * ```
 */
import { Core } from "@gmloop/core";

import { createIntegerRuntimeOptionState } from "./integer-runtime-option-state.js";

const { coercePositiveInteger } = Core;

const DEFAULT_PROGRESS_BAR_WIDTH = 24;
const PROGRESS_BAR_WIDTH_ENV_VAR = "GML_PROGRESS_BAR_WIDTH";

/**
 * Minimal contract a progress bar implementation must satisfy.
 *
 * The registry stores instances behind this interface so tests can inject
 * deterministic doubles that record the call sequence. The methods mirror
 * the lifecycle used by the default terminal implementation: {@link start}
 * allocates a row and primes the cursor, {@link setTotal} and
 * {@link update} mutate in-place, and {@link stop} tears the row down and
 * releases the cursor.
 */
export interface ProgressBarLike {
    /**
     * Start rendering with an initial `total` and `current` value.
     *
     * Implementations are expected to allocate any terminal resources
     * (e.g., the cursor-hide escape sequence) on the first call and leave
     * subsequent calls cheap.
     */
    start: (total: number, current: number) => void;
    /** Update the bar's denominator without changing the numerator. */
    setTotal: (total: number) => void;
    /** Update the bar's numerator. Implementations clamp to `[0, total]`. */
    update: (current: number) => void;
    /**
     * Stop rendering, restore any terminal state taken in {@link start},
     * and release the bar from the registry. Safe to call when not active.
     */
    stop: (...args: Array<unknown>) => void;
}

const activeProgressBars = new Map<string, ProgressBarLike>();

const CURSOR_HIDE_SEQUENCE = "\u001B[?25l";
const CURSOR_SHOW_SEQUENCE = "\u001B[?25h";
const CLEAR_LINE_SEQUENCE = "\u001B[2K";
const CARRIAGE_RETURN = "\r";
const COMPLETE_CHAR = "█";
const INCOMPLETE_CHAR = "░";

/**
 * Minimal stream surface required to render a progress bar.
 *
 * Only `write` is mandatory; {@link isTTY} is consulted by
 * {@link shouldRenderProgressBar} to suppress carriage-return redraws on
 * non-interactive streams (e.g. when stdout is redirected to a file or
 * piped into another command). The interface is intentionally narrow so
 * tests can pass an object literal that records every chunk without
 * depending on `node:tty`.
 */
export interface ProgressBarStream {
    /** Append a chunk of text to the underlying stream. */
    write: (chunk: string) => void;
    /**
     * `true` when the stream is attached to a terminal that supports
     * cursor positioning and ANSI escapes. Omit (or set to `false`) for
     * file/pipe output to disable progress rendering.
     */
    isTTY?: boolean;
}

/**
 * Construction-time options accepted by the default progress bar factory.
 *
 * @property stream Target stream. When omitted, the factory falls back to
 *   `process.stdout` so the most common call site (`renderProgressBar`)
 *   works without explicit configuration.
 */
interface ProgressBarOptions {
    stream?: ProgressBarStream;
}

type ProgressBarFactory = (label: string, width: number, options: ProgressBarOptions) => ProgressBarLike;

/**
 * Default {@link ProgressBarLike} implementation that redraws a single
 * source line on a TTY stream.
 *
 * Each instance owns a fixed `label` and `width` and writes the row using
 * `"\r" + ANSI clear-line + "<label> [<bar>] <current>/<total>"`. Cursor
 * visibility is hidden for the lifetime of the bar and restored on
 * {@link TerminalProgressBar.stop}, but only when the underlying stream
 * reports `isTTY` — escape sequences are silently skipped on non-interactive
 * streams so the helper is safe to call regardless of how the CLI is
 * invoked.
 *
 * Invariants:
 * - `total` is always at least `1` so the fill ratio never divides by zero.
 * - `current` is always clamped to `[0, total]`, even when callers pass
 *   non-numeric or out-of-range values via {@link TerminalProgressBar.update}.
 * - The `active` flag is the only state that gates rendering; once `stop()`
 *   has run, the bar is dormant and a subsequent `start()` re-arms it.
 */
class TerminalProgressBar implements ProgressBarLike {
    private readonly label: string;
    private readonly width: number;
    private readonly stream: ProgressBarStream;
    private total: number;
    private current: number;
    private active: boolean;
    private cursorHidden: boolean;

    /**
     * @param label Text prefix shown before the bar (e.g. `"[format]"`).
     * @param width Visible width in characters. Negative values are clamped
     *   to `0`; a width of `0` is treated as "rendering disabled" by
     *   {@link shouldRenderProgressBar}.
     * @param options Stream override; defaults to `process.stdout` when no
     *   writable stream is supplied.
     */
    constructor(label: string, width: number, { stream }: ProgressBarOptions = {}) {
        this.label = label;
        this.width = Math.max(0, width);
        this.stream = typeof stream?.write === "function" ? stream : process.stdout;
        this.total = 1;
        this.current = 0;
        this.active = false;
        this.cursorHidden = false;
    }

    /**
     * Begin rendering and write the first row.
     *
     * Hides the cursor on TTY streams and clamps `current` to the new
     * `total` so the displayed ratio never overshoots the bar width.
     */
    start(total: number, current: number): void {
        this.total = Math.max(1, total);
        this.current = this.#normalizeCurrent(current);
        this.active = true;
        this.#hideCursor();
        this.#render();
    }

    /**
     * Change the denominator in place and re-render the bar.
     *
     * Re-clamps the current numerator against the new total so callers can
     * grow or shrink the bar without an intermediate `stop()`/`start()`
     * cycle. No-op when the bar is not active.
     */
    setTotal(total: number): void {
        this.total = Math.max(1, total);
        this.current = this.#normalizeCurrent(this.current);
        if (this.active) {
            this.#render();
        }
    }

    /**
     * Update the numerator in place. Non-finite inputs are coerced to `0`
     * and the result is clamped to `[0, total]` so the bar cannot overflow.
     */
    update(current: number): void {
        this.current = this.#normalizeCurrent(current);
        if (this.active) {
            this.#render();
        }
    }

    /**
     * Tear the bar down: clear the row, restore the cursor, and mark the
     * instance as dormant. Safe to call when not active; subsequent
     * {@link TerminalProgressBar.start} re-arms the bar from scratch.
     */
    stop(): void {
        if (!this.active) {
            return;
        }

        this.active = false;
        this.#clearLine();
        this.#showCursor();
    }

    #normalizeCurrent(value: unknown): number {
        const numeric =
            typeof value === "number" && Number.isFinite(value)
                ? value
                : typeof value === "string"
                  ? Number.parseFloat(value)
                  : Number.NaN;

        return Number.isFinite(numeric) ? Core.clamp(numeric, 0, this.total) : 0;
    }

    #render(): void {
        const ratio = this.total > 0 ? this.current / this.total : 0;
        const filled = Math.round(ratio * this.width);
        const filledWidth = Core.clamp(filled, 0, this.width);
        const complete = COMPLETE_CHAR.repeat(filledWidth);
        const incomplete = INCOMPLETE_CHAR.repeat(this.width - filledWidth);
        const bar = `${complete}${incomplete}`;
        const output = `${this.label} [${bar}] ${this.current}/${this.total}`;

        this.#write(`${CARRIAGE_RETURN}${CLEAR_LINE_SEQUENCE}${output}`);
    }

    #clearLine(): void {
        this.#write(`${CARRIAGE_RETURN}${CLEAR_LINE_SEQUENCE}`);
    }

    #hideCursor(): void {
        if (this.cursorHidden) {
            return;
        }

        if (this.stream?.isTTY) {
            this.#write(CURSOR_HIDE_SEQUENCE);
            this.cursorHidden = true;
        }
    }

    #showCursor(): void {
        if (!this.cursorHidden) {
            return;
        }

        if (this.stream?.isTTY) {
            this.#write(CURSOR_SHOW_SEQUENCE);
        }

        this.cursorHidden = false;
    }

    #write(chunk: string): void {
        if (typeof this.stream?.write === "function") {
            this.stream.write(chunk);
        }
    }
}

const runtimeOptionState = createIntegerRuntimeOptionState({
    defaultValue: DEFAULT_PROGRESS_BAR_WIDTH,
    envVar: PROGRESS_BAR_WIDTH_ENV_VAR,
    optionLabel: "Progress bar width",
    createValueErrorMessage: (receivedDescription) =>
        `Progress bar width must be a positive integer (received ${receivedDescription}).`,
    coerceInteger: coercePositiveInteger
});

/**
 * Read the current default progress-bar width.
 *
 * @returns The active width, or `undefined` if the caller (or the
 *   `GML_PROGRESS_BAR_WIDTH` environment variable) has not configured one
 *   beyond the {@link DEFAULT_PROGRESS_BAR_WIDTH} baseline.
 */
function getDefaultProgressBarWidth(): number | undefined {
    return runtimeOptionState.get();
}

/**
 * Override the default progress-bar width for the current process.
 *
 * Passing `undefined` resets the value to the baseline default and any
 * `GML_PROGRESS_BAR_WIDTH` override the environment supplied at startup.
 *
 * @param value Positive integer width, or `undefined` to clear the override.
 * @returns The resulting active width, or `undefined` when the state is
 *   cleared and the baseline takes over.
 */
function setDefaultProgressBarWidth(value?: unknown): number | undefined {
    return runtimeOptionState.set(value);
}

/**
 * Normalize a caller-supplied progress-bar width.
 *
 * Accepts the same loose inputs the CLI does (numeric, numeric strings,
 * or `undefined`) and produces a positive integer. Blank strings fall
 * back to the supplied default so environment-driven overrides can be
 * cleared without raising.
 *
 * @param rawValue Candidate width. Strings are trimmed and parsed.
 * @param options Resolution options. `defaultWidth` takes precedence over
 *   `defaultValue`; both fall back to the process-wide
 *   {@link getDefaultProgressBarWidth} state.
 * @returns The resolved width, or `null`/`undefined` when the input is
 *   non-numeric and no default is available.
 */
function resolveProgressBarWidth(
    rawValue?: unknown,
    options: Record<string, unknown> & {
        defaultValue?: number;
        defaultWidth?: number;
    } = {}
): number | null | undefined {
    return runtimeOptionState.resolve(rawValue, {
        defaultValue: options.defaultValue,
        defaultOverride: options.defaultWidth
    });
}

/**
 * Re-read the `GML_PROGRESS_BAR_WIDTH` environment variable and update
 * the shared state.
 *
 * Mostly useful in tests that mutate `process.env` between cases; the
 * module also invokes this once at import time so the initial value is
 * available without an extra call.
 *
 * @param env Environment map to read from; defaults to `process.env`.
 * @returns The width that resulted from the re-application, or `undefined`
 *   when the environment did not provide one.
 */
function applyProgressBarWidthEnvOverride(env?: NodeJS.ProcessEnv): number | undefined {
    return runtimeOptionState.applyEnvOverride(env);
}

applyProgressBarWidthEnvOverride();

/**
 * Stop and evict every active progress bar in the registry.
 *
 * Used by {@link withProgressBarCleanup} and test reset hooks. Failures
 * from a single bar's `stop()` are swallowed so the loop can keep tearing
 * the remaining bars down — leaving an orphaned cursor-hidden row in the
 * terminal is worse than skipping a single cleanup call.
 */
function disposeProgressBars(): void {
    for (const [, bar] of activeProgressBars) {
        try {
            bar.stop();
        } catch {
            // Ignore cleanup failures so disposal continues for remaining bars.
            // If one progress bar fails to stop (e.g., due to terminal I/O errors),
            // the cleanup loop must continue tearing down the other bars to avoid
            // leaving orphaned progress indicators in the terminal. This resilience
            // ensures all bars are given a chance to clean up, even if one fails.
        }
    }
    activeProgressBars.clear();
}

/**
 * Clear the active-bar registry without invoking each bar's `stop()`.
 *
 * Exists exclusively for tests that wire mock bars whose `stop()` is a
 * no-op; production code should call {@link disposeProgressBars} so the
 * terminal state is restored. Both helpers leave the registry empty
 * afterwards.
 */
function resetProgressBarRegistryForTesting(): void {
    disposeProgressBars();
}

/**
 * Decide whether a bar should be drawn on the supplied stream.
 *
 * Returns `false` for non-TTY streams (where `\r`-based redraws would
 * corrupt log output) and for zero-width configurations (the documented
 * "rendering disabled" signal).
 *
 * @param stdout Target stream; `undefined` is treated as non-TTY.
 * @param width Configured width in characters.
 * @returns `true` when the bar is allowed to redraw the source row.
 */
function shouldRenderProgressBar(stdout: ProgressBarStream | undefined, width: number): boolean {
    return Boolean(stdout?.isTTY) && width > 0;
}

/**
 * Stop the bar registered under `label` and remove it from the registry.
 *
 * @param label Bar identifier (matches the `label` argument to
 *   {@link renderProgressBar}). No-op when no bar is registered.
 * @param options.suppressErrors When `true`, errors from `bar.stop()` are
 *   swallowed so callers can still evict the entry during teardown.
 *   Defaults to `false`, which lets `bar.stop()` throw to surface
 *   terminal I/O bugs.
 */
function stopAndRemoveProgressBar(label: string, { suppressErrors = false }: { suppressErrors?: boolean } = {}): void {
    const bar = activeProgressBars.get(label);

    if (!bar) {
        return;
    }

    const removeBar = () => {
        activeProgressBars.delete(label);
    };

    if (!suppressErrors) {
        bar.stop();
        removeBar();
        return;
    }

    try {
        bar.stop();
    } catch {
        // Ignore cleanup failures so callers can continue unwinding their own
        // teardown logic without masking the original failure that disabled
        // progress rendering mid-run.
    }

    removeBar();
}

/**
 * Draw or update a single progress bar identified by `label`.
 *
 * The first call for a given `label` allocates a bar (using
 * {@link TerminalProgressBar} by default, or the supplied
 * `options.createBar` factory) and registers it; subsequent calls reuse
 * the same instance so the row is redrawn in place. When `current` reaches
 * `total` the bar is stopped and evicted automatically.
 *
 * When the destination stream is non-TTY (or `width` is `0`) the call is
 * a no-op except for the cleanup of any pre-existing bar for the same
 * label — this keeps the registry consistent when the environment
 * changes mid-run (e.g., a CLI is piped into `tee`).
 *
 * @param label Bar identifier; reused across calls to address the same bar.
 * @param current Current progress numerator, clamped to `[0, total]`.
 * @param total Progress denominator. Non-positive values are coerced to
 *   `1` so the fill ratio never divides by zero.
 * @param width Visible bar width in characters; `0` disables rendering.
 * @param options Optional `stdout` and `createBar` overrides. The factory
 *   must be a function of `(label, width, { stream })`; passing any other
 *   type raises `TypeError`.
 */
function renderProgressBar(
    label: string,
    current: number,
    total: number,
    width: number,
    options: {
        stdout?: ProgressBarStream;
        createBar?: ProgressBarFactory;
    } = {}
): void {
    const { stdout = process.stdout, createBar } = options;

    if (!shouldRenderProgressBar(stdout, width)) {
        stopAndRemoveProgressBar(label, { suppressErrors: true });
        return;
    }

    const normalizedTotal = total > 0 ? total : 1;
    const normalizedCurrent = Math.min(current, normalizedTotal);

    let bar = activeProgressBars.get(label);

    if (bar) {
        bar.setTotal(normalizedTotal);
        bar.update(normalizedCurrent);
    } else {
        const stream = stdout && typeof stdout.write === "function" ? stdout : undefined;

        if (createBar !== undefined && typeof createBar !== "function") {
            throw new TypeError("createBar must be a function when provided.");
        }

        bar =
            createBar === undefined
                ? new TerminalProgressBar(label, width, { stream })
                : createBar(label, width, { stream });
        activeProgressBars.set(label, bar);
        bar.start(normalizedTotal, normalizedCurrent);
    }

    if (normalizedCurrent >= normalizedTotal) {
        stopAndRemoveProgressBar(label);
    }
}

/**
 * Run `callback` and dispose every active progress bar once it settles.
 *
 * Designed for top-level CLI commands that drive one or more progress
 * bars over their full lifetime: the `finally` block guarantees
 * {@link disposeProgressBars} runs whether the callback resolves,
 * rejects, or throws synchronously, so the cursor is always restored and
 * the registry is empty when the command returns.
 *
 * @param callback Synchronous or async work to perform. Must be a
 *   function; passing anything else raises `TypeError`.
 * @returns Whatever the callback returns or resolves to.
 */
async function withProgressBarCleanup<TResult>(callback: () => Promise<TResult> | TResult): Promise<TResult> {
    if (typeof callback !== "function") {
        throw new TypeError("withProgressBarCleanup requires a callback function.");
    }

    try {
        return await callback();
    } finally {
        disposeProgressBars();
    }
}

export {
    applyProgressBarWidthEnvOverride,
    DEFAULT_PROGRESS_BAR_WIDTH,
    disposeProgressBars,
    getDefaultProgressBarWidth,
    PROGRESS_BAR_WIDTH_ENV_VAR,
    renderProgressBar,
    resetProgressBarRegistryForTesting,
    resolveProgressBarWidth,
    setDefaultProgressBarWidth,
    withProgressBarCleanup
};
