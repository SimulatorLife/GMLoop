import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Visual status the copy button can surface after a copy attempt.
 *
 * The primitive only transitions through this closed set of strings so the
 * template, screen-reader live region, and CSS class names stay aligned.
 */
export type CopyFeedbackStatus = "idle" | "success" | "error";

/**
 * Default duration, in milliseconds, the success or error badge stays
 * visible before the controller resets back to `idle`.
 */
const DEFAULT_FEEDBACK_DURATION_MS = 1500;

/**
 * Asynchronous copy delegate used by the controller.
 *
 * Returning `true` reports a successful copy; `false` reports the copy was
 * blocked or unavailable. The delegate is responsible for picking the
 * appropriate browser API and for swallowing transient errors.
 */
export type CopyDelegate = (value: string) => Promise<boolean>;

/**
 * Wired callbacks the host element supplies so the controller can keep its
 * state in sync without reaching into host internals.
 */
export interface CopyFeedbackControllerCallbacks {
    /**
     * Returns the host's current copy value. Read lazily on every host
     * update so the controller does not need to be wired into the host's
     * property setter.
     */
    getValue: () => string;
    /**
     * Invoked whenever the controller transitions between idle, success,
     * and error states. The host should call `requestUpdate()` to keep its
     * rendered output in sync.
     */
    onChange: () => void;
}

/**
 * Options accepted by {@link CopyFeedbackController}.
 */
export interface CopyFeedbackControllerOptions {
    /** Asynchronous copy delegate (e.g. {@link writeValueToClipboard}). */
    copy: CopyDelegate;
    /** Callbacks the host element uses to expose state and trigger updates. */
    callbacks: CopyFeedbackControllerCallbacks;
    /**
     * Override the default success/error badge duration in milliseconds.
     * Defaults to {@link DEFAULT_FEEDBACK_DURATION_MS}.
     */
    feedbackDurationMs?: number;
}

/**
 * Reactive controller that owns the copy button's feedback state machine.
 *
 * The controller composes three concerns that previously lived inside the
 * `GmCopyButton` subclass as lifecycle overrides:
 *
 * 1. **Status state machine** — transitions between `idle`, `success`, and
 *    `error` and exposes the current status via {@link status}.
 * 2. **Reset timer** — clears the badge back to `idle` after a configurable
 *    duration so screen readers and visual feedback do not stick.
 * 3. **Value-change reset** — when the host's `value` accessor changes,
 *    Lit calls `hostUpdate()` on every registered controller; this
 *    controller uses that hook to drop any in-flight success/error state
 *    so a stale badge cannot survive a value swap.
 *
 * Composing these concerns lets {@link GmCopyButton} drop three of its four
 * Lit lifecycle overrides (`connectedCallback`, `disconnectedCallback`, and
 * `willUpdate`) and keep only the `render` override it actually needs.
 */
export class CopyFeedbackController implements ReactiveController {
    #callbacks: CopyFeedbackControllerCallbacks;
    #copy: CopyDelegate;
    #feedbackDurationMs: number;
    #status: CopyFeedbackStatus = "idle";
    #resetTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
    #lastValue: string | null = null;

    public constructor(host: ReactiveControllerHost, options: CopyFeedbackControllerOptions) {
        this.#callbacks = options.callbacks;
        this.#copy = options.copy;
        this.#feedbackDurationMs = options.feedbackDurationMs ?? DEFAULT_FEEDBACK_DURATION_MS;
        host.addController(this);
    }

    /**
     * The current status the host should render. Transitions through this
     * getter call {@link CopyFeedbackControllerCallbacks.onChange} so the
     * host re-renders without manual wiring.
     */
    public get status(): CopyFeedbackStatus {
        return this.#status;
    }

    public hostConnected(): void {
        this.#lastValue = this.#callbacks.getValue();
    }

    public hostDisconnected(): void {
        this.#clearResetTimer();
    }

    /**
     * Called by Lit before each render. When the host's value has changed
     * since the last update, the controller drops any in-flight feedback
     * state so a stale badge cannot survive a value swap.
     */
    public hostUpdate(): void {
        const currentValue = this.#callbacks.getValue();
        if (currentValue === this.#lastValue) {
            return;
        }

        this.#lastValue = currentValue;
        this.#resetToIdle();
    }

    /**
     * Run the copy delegate against the host's current value and flip the
     * controller into success or error state. Schedules a reset back to
     * idle after {@link CopyFeedbackControllerOptions.feedbackDurationMs}.
     */
    public async trigger(): Promise<void> {
        const value = this.#callbacks.getValue();
        if (value.length === 0) {
            return;
        }

        const copied = await this.#copy(value);
        this.#status = copied ? "success" : "error";
        this.#callbacks.onChange();
        this.#clearResetTimer();
        this.#resetTimer = globalThis.setTimeout(() => {
            this.#resetTimer = null;
            this.#resetToIdle();
        }, this.#feedbackDurationMs);
    }

    #resetToIdle(): void {
        if (this.#status === "idle") {
            this.#callbacks.onChange();
            return;
        }

        this.#status = "idle";
        this.#callbacks.onChange();
    }

    #clearResetTimer(): void {
        if (this.#resetTimer !== null) {
            globalThis.clearTimeout(this.#resetTimer);
            this.#resetTimer = null;
        }
    }
}
