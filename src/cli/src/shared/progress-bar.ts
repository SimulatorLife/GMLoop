import { Core } from "@gmloop/core";

import { createIntegerEnvConfiguredValue } from "./env-configured-integer.js";

const { coercePositiveInteger, createNumericTypeErrorFormatter, describeValueForError, resolveIntegerOption } = Core;

const DEFAULT_PROGRESS_BAR_WIDTH = 24;
const PROGRESS_BAR_WIDTH_ENV_VAR = "GML_PROGRESS_BAR_WIDTH";
export interface ProgressBarLike {
    start: (total: number, current: number) => void;
    setTotal: (total: number) => void;
    update: (current: number) => void;
    stop: (...args: Array<unknown>) => void;
}

const activeProgressBars = new Map<string, ProgressBarLike>();

const CURSOR_HIDE_SEQUENCE = "\u001B[?25l";
const CURSOR_SHOW_SEQUENCE = "\u001B[?25h";
const CLEAR_LINE_SEQUENCE = "\u001B[2K";
const CARRIAGE_RETURN = "\r";
const COMPLETE_CHAR = "█";
const INCOMPLETE_CHAR = "░";

export interface ProgressBarStream {
    write: (chunk: string) => void;
    isTTY?: boolean;
}

interface ProgressBarOptions {
    stream?: ProgressBarStream;
}

type ProgressBarFactory = (label: string, width: number, options: ProgressBarOptions) => ProgressBarLike;

class TerminalProgressBar implements ProgressBarLike {
    private readonly label: string;
    private readonly width: number;
    private readonly stream: ProgressBarStream;
    private total: number;
    private current: number;
    private active: boolean;
    private cursorHidden: boolean;

    constructor(label: string, width: number, { stream }: ProgressBarOptions = {}) {
        this.label = label;
        this.width = Math.max(0, width);
        this.stream = typeof stream?.write === "function" ? stream : process.stdout;
        this.total = 1;
        this.current = 0;
        this.active = false;
        this.cursorHidden = false;
    }

    start(total: number, current: number): void {
        this.total = Math.max(1, total);
        this.current = this.#normalizeCurrent(current);
        this.active = true;
        this.#hideCursor();
        this.#render();
    }

    setTotal(total: number): void {
        this.total = Math.max(1, total);
        this.current = this.#normalizeCurrent(this.current);
        if (this.active) {
            this.#render();
        }
    }

    update(current: number): void {
        this.current = this.#normalizeCurrent(current);
        if (this.active) {
            this.#render();
        }
    }

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

const createWidthErrorMessage = (received: unknown) =>
    `Progress bar width must be a positive integer (received ${describeValueForError(received)}).`;

const createWidthTypeErrorMessage = createNumericTypeErrorFormatter("Progress bar width");

const coerce = (value: unknown, context = {}) => {
    const opts = { ...context, createErrorMessage: createWidthErrorMessage };
    return coercePositiveInteger(value, opts);
};

const state = createIntegerEnvConfiguredValue({
    defaultValue: DEFAULT_PROGRESS_BAR_WIDTH,
    envVar: PROGRESS_BAR_WIDTH_ENV_VAR,
    coerce,
    typeErrorMessage: createWidthTypeErrorMessage
});

function getDefaultProgressBarWidth(): number | undefined {
    return state.get();
}

function setDefaultProgressBarWidth(value?: unknown): number | undefined {
    return state.set(value);
}

function resolveProgressBarWidth(
    rawValue?: unknown,
    options: Record<string, unknown> & {
        defaultValue?: number;
        defaultWidth?: number;
    } = {}
): number | null | undefined {
    const fallback = options.defaultWidth ?? options.defaultValue ?? state.get();
    return resolveIntegerOption(rawValue, {
        defaultValue: fallback,
        coerce,
        typeErrorMessage: createWidthTypeErrorMessage,
        blankStringReturnsDefault: true
    });
}

function applyProgressBarWidthEnvOverride(env?: NodeJS.ProcessEnv): number | undefined {
    return state.applyEnvOverride(env);
}

applyProgressBarWidthEnvOverride();

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

function resetProgressBarRegistryForTesting(): void {
    disposeProgressBars();
}

function shouldRenderProgressBar(stdout: ProgressBarStream | undefined, width: number): boolean {
    return Boolean(stdout?.isTTY) && width > 0;
}

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
