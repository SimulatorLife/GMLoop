import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Fixture descriptor returned by the playground `/api/playground/fixtures`
 * endpoint. Mirrors the shape produced by the playground fixtures plugin in
 * `src/agent-pack/.../playground-fixtures-plugin.ts` and the doc fixtures the
 * UI uses to seed the playground dropdown.
 */
export interface PlaygroundFixture {
    caseId: string;
    config: Record<string, unknown>;
    expectedGml: string | null;
    inputGml: string;
    kind: string;
}

/**
 * Result of resolving a playground fixture selection. Encapsulates the data
 * the host needs to apply fixture-specific configuration (input text,
 * expected output, config map) without leaking the controller's internal
 * fixtures list or selected-id bookkeeping.
 */
export interface PlaygroundFixtureSelection {
    config: Record<string, unknown> | null;
    expectedGml: string | null;
    inputGml: string | null;
    selectedFixtureId: string;
}

/**
 * Result returned from {@link PlaygroundFixturesController.loadFixturesForTest}
 * to assert that the controller requested the expected fixtures payload.
 */
export interface PlaygroundFixturesFetchResult {
    ok: boolean;
    payload: unknown;
}

const PLAYGROUND_FIXTURES_ENDPOINT_PATHNAME = "/api/playground/fixtures";

/**
 * Compose this reactive controller alongside the playground panel to own the
 * fixture list, the selected fixture id, and the expected GML the panel
 * compares against processed output. The controller fetches fixtures lazily
 * from the playground endpoint when the host connects and exposes a small
 * selection API the host calls from the dropdown change handler.
 *
 * Moving the fixture state into a collaborator lets the host panel drop its
 * `connectedCallback`/`disconnectedCallback` overrides entirely: connect
 * timing, fetch lifecycle, and selection bookkeeping all live here so the
 * panel only needs to render and react.
 */
export class PlaygroundFixturesController implements ReactiveController {
    #host: ReactiveControllerHost;
    #fixtures: ReadonlyArray<PlaygroundFixture> = [];
    #selectedFixtureId = "";
    #expectedGml: string | null = null;
    #loadingFixtures = false;

    public constructor(host: ReactiveControllerHost) {
        this.#host = host;
        host.addController(this);
    }

    public hostConnected(): void {
        void this.#loadFixtures();
    }

    public hostDisconnected(): void {
        this.#loadingFixtures = false;
    }

    public getFixtures(): ReadonlyArray<PlaygroundFixture> {
        return this.#fixtures;
    }

    public getSelectedFixtureId(): string {
        return this.#selectedFixtureId;
    }

    public getExpectedGml(): string | null {
        return this.#expectedGml;
    }

    public isLoading(): boolean {
        return this.#loadingFixtures;
    }

    public getFixtureById(fixtureId: string): PlaygroundFixture | undefined {
        return this.#fixtures.find((fixture) => fixture.caseId === fixtureId);
    }

    public getSelectedFixtureKind(): string | null {
        if (!this.#selectedFixtureId) {
            return null;
        }
        return this.getFixtureById(this.#selectedFixtureId)?.kind ?? null;
    }

    /**
     * Select a fixture by id, returning the data the host needs to apply
     * fixture configuration to its rule-selection state. When the requested
     * id is unknown, the controller clears its selection so the host can
     * fall back to free-form input.
     */
    public selectFixture(fixtureId: string): PlaygroundFixtureSelection {
        const fixture = this.getFixtureById(fixtureId);
        if (!fixture) {
            this.#selectedFixtureId = "";
            this.#expectedGml = null;
            this.#host.requestUpdate();
            return { config: null, expectedGml: null, inputGml: null, selectedFixtureId: "" };
        }

        this.#selectedFixtureId = fixture.caseId;
        this.#expectedGml = fixture.expectedGml;
        this.#host.requestUpdate();
        return {
            config: fixture.config,
            expectedGml: fixture.expectedGml,
            inputGml: fixture.inputGml,
            selectedFixtureId: fixture.caseId
        };
    }

    /** Replace the fixtures list (used by tests that bypass the fetch). */
    public setFixturesForTest(fixtures: ReadonlyArray<PlaygroundFixture>): void {
        this.#fixtures = fixtures;
        this.#host.requestUpdate();
    }

    /** Replace the expected GML for the currently selected fixture (test seam). */
    public setExpectedGmlForTest(value: string | null): void {
        this.#expectedGml = value;
    }

    /**
     * Fetch the fixtures payload from the playground endpoint and update the
     * controller's internal list. Idempotent: a request already in flight (or
     * a non-empty fixture list) short-circuits to avoid redundant network
     * work between the first host connect and later re-entries.
     */
    async #loadFixtures(): Promise<void> {
        if (this.#fixtures.length > 0 || this.#loadingFixtures) {
            return;
        }
        this.#loadingFixtures = true;
        try {
            const response = await fetch(PLAYGROUND_FIXTURES_ENDPOINT_PATHNAME);
            if (response.ok) {
                const data = (await response.json()) as { fixtures?: ReadonlyArray<PlaygroundFixture> };
                this.#fixtures = data.fixtures ?? [];
            }
        } catch {
            // Network errors are swallowed here; the playground surfaces its
            // own error banner when /api/playground/process fails, so a
            // missing fixture list just leaves the dropdown empty.
        } finally {
            this.#loadingFixtures = false;
            this.#host.requestUpdate();
        }
    }
}
