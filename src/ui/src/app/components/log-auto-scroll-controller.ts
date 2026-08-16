import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Distance, in pixels, an element may be scrolled up from its bottom edge
 * and still be considered "following" newly appended log content.
 */
const BOTTOM_PIN_THRESHOLD_PX = 24;

/**
 * Callbacks the host element supplies so the controller can locate the
 * scrollable log element without being wired into host properties.
 */
export interface LogAutoScrollControllerCallbacks {
    /**
     * Returns the scrollable element holding streamed log text, or `null`
     * before the host has rendered it for the first time.
     */
    getElement: () => HTMLElement | null;
}

/**
 * Reactive controller that keeps a streaming log element pinned to its
 * bottom edge as new lines are appended, without fighting a reader who has
 * scrolled up to review earlier output.
 *
 * The pin decision is made in `hostUpdate()`, which Lit calls immediately
 * before re-rendering: at that point the element still reflects the
 * previous render's content, so measuring its scroll position there tells
 * us whether the reader was already at the bottom. `hostUpdated()` then
 * runs after the new content lands and, only if the reader was pinned,
 * scrolls the element back to its (now taller) bottom edge.
 */
export class LogAutoScrollController implements ReactiveController {
    #callbacks: LogAutoScrollControllerCallbacks;
    #shouldPinToBottom = true;

    public constructor(host: ReactiveControllerHost, callbacks: LogAutoScrollControllerCallbacks) {
        this.#callbacks = callbacks;
        host.addController(this);
    }

    public hostUpdate(): void {
        const element = this.#callbacks.getElement();
        if (element === null) {
            this.#shouldPinToBottom = true;
            return;
        }

        const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
        this.#shouldPinToBottom = distanceFromBottom <= BOTTOM_PIN_THRESHOLD_PX;
    }

    public hostUpdated(): void {
        if (!this.#shouldPinToBottom) {
            return;
        }

        const element = this.#callbacks.getElement();
        if (element !== null) {
            element.scrollTop = element.scrollHeight;
        }
    }
}
