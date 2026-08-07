import type { LifecycleParticipant } from "./lifecycle-participants-controller.js";

/**
 * Callback fired every time the host connects so the playground can ask the
 * server to hydrate its fixture catalog. The host is responsible for its own
 * de-duplication; calling the callback on every connect preserves the
 * previous behaviour of the hand-rolled `connectedCallback` override that
 * always invoked `void #loadFixtures()` regardless of how many times the
 * element reconnected to the DOM.
 */
export interface PlaygroundFixtureLoaderCallbacks {
    onLoadRequested: () => void;
}

/**
 * Lifecycle participant that asks the host to load its playground fixtures
 * on connect.
 *
 * The previous implementation duplicated this behaviour inside the host's
 * `connectedCallback` override. Hosting the request behind a
 * {@link LifecycleParticipant} keeps the panel free of Lit lifecycle
 * overrides and lets the {@link EventBusManager} and
 * {@link PlaygroundFixtureLoader} share a single
 * {@link LifecycleParticipantsController}, mirroring the composition pattern
 * used by `GmFixPanel`, `GmGraphPanel`, and the other workspace panels.
 *
 * `disconnect` is a no-op because the fixture fetch is fire-and-forget and
 * the host panel owns its own deduplication/caching of the fetched
 * fixtures.
 */
export class PlaygroundFixtureLoader implements LifecycleParticipant {
    #callbacks: PlaygroundFixtureLoaderCallbacks;

    public constructor(callbacks: PlaygroundFixtureLoaderCallbacks) {
        this.#callbacks = callbacks;
    }

    public connect(): void {
        this.#callbacks.onLoadRequested();
    }

    public disconnect(): void {
        // The fixture fetch is intentionally fire-and-forget; nothing to clean up.
    }
}
