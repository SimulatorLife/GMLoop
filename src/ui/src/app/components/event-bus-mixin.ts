/**
 * A single registered event subscription managed by `EventBusManager`.
 */
interface EventSubscription {
    readonly event: string;
    readonly handler: (value: Event) => void;
}

/**
 * Collaborator that auto-registers and unregisters an array of event
 * subscriptions when the host element is connected/disconnected.
 *
 * Subscriptions are torn down in reverse registration order so that nested
 * or overlapping subscriptions unwind predictably.
 *
 * @example
 * ```ts
 * const busManager = new EventBusManager(element, [
 *   { event: "my-event", handler: this.#handleMyEvent }
 * ]);
 * // On connected: busManager.connect()
 * // On disconnected: busManager.disconnect()
 * ```
 */
export class EventBusManager {
    #element: EventTarget;
    #subscriptions: EventSubscription[] = [];
    #isConnected = false;

    public constructor(element: EventTarget, subscriptions: readonly EventSubscription[]) {
        this.#element = element;
        this.#subscriptions = [...subscriptions];
    }

    /**
     * Register all subscriptions on the target element.
     */
    public connect(): void {
        if (this.#isConnected) {
            return;
        }

        for (const { event, handler } of this.#subscriptions) {
            this.#element.addEventListener(event, handler);
        }
        this.#isConnected = true;
    }

    /**
     * Unregister all subscriptions in reverse order from the target element.
     */
    public disconnect(): void {
        if (!this.#isConnected) {
            return;
        }

        for (const { event, handler } of this.#subscriptions.toReversed()) {
            this.#element.removeEventListener(event, handler);
        }
        this.#isConnected = false;
    }
}
