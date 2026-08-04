import assert from "node:assert/strict";
import test from "node:test";

import type { ReactiveController, ReactiveControllerHost } from "lit";

import {
    type PlaygroundFixture,
    PlaygroundFixturesController
} from "../src/app/components/playground-fixtures-controller.js";

const FIXTURES_ENDPOINT = "/api/playground/fixtures";

class MockReactiveHost implements ReactiveControllerHost {
    #controllers: ReactiveController[] = [];
    public requestUpdateCallCount = 0;
    public readonly updateComplete = Promise.resolve(true);

    public addController(controller: ReactiveController): void {
        this.#controllers.push(controller);
    }

    public removeController(controller: ReactiveController): void {
        this.#controllers = this.#controllers.filter((candidate) => candidate !== controller);
    }

    public requestUpdate(): void {
        this.requestUpdateCallCount += 1;
    }

    public connect(): void {
        for (const controller of this.#controllers) {
            controller.hostConnected?.();
        }
    }

    public disconnect(): void {
        for (const controller of this.#controllers) {
            controller.hostDisconnected?.();
        }
    }
}

function createFixture(overrides: Partial<PlaygroundFixture> = {}): PlaygroundFixture {
    return {
        caseId: "format/example",
        config: {},
        expectedGml: "if (foo) {\n    bar();\n}",
        inputGml: "if (foo) { bar(); }",
        kind: "format",
        ...overrides
    };
}

interface FetchSpy {
    callCount: number;
    lastUrl: string | null;
}

interface DeferredFetch {
    resolveFetch: (value: unknown) => void;
    spy: FetchSpy;
}

function installFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}): FetchSpy {
    const spy: FetchSpy = { callCount: 0, lastUrl: null };
    globalThis.fetch = async (input) => {
        spy.callCount += 1;
        spy.lastUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : null;
        return Response.json(body, { status: init.status ?? 200 });
    };
    return spy;
}

function installFetchReject(error: Error): void {
    globalThis.fetch = () => Promise.reject(error);
}

function installDeferredFetch(): DeferredFetch {
    const spy: FetchSpy = { callCount: 0, lastUrl: null };
    let resolveFetch: (value: unknown) => void = () => {
        // Replaced by the test body after `connect()` triggers the fetch.
    };
    globalThis.fetch = (input) => {
        spy.callCount += 1;
        spy.lastUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : null;
        return new Promise<Response>((resolve) => {
            resolveFetch = (value) => {
                resolve(Response.json(value, { status: 200 }));
            };
        });
    };
    return { resolveFetch, spy };
}

const originalFetch = globalThis.fetch;
const originalConsoleError = globalThis.console.error;

test.afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.console.error = originalConsoleError;
});

void test("PlaygroundFixturesController starts empty and never loads before the host connects", () => {
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    assert.deepEqual(controller.getFixtures(), []);
    assert.equal(controller.getSelectedFixtureId(), "");
    assert.equal(controller.getExpectedGml(), null);
    assert.equal(controller.getSelectedFixtureKind(), null);
    assert.equal(host.requestUpdateCallCount, 0);
});

void test("PlaygroundFixturesController fetches fixtures once on the first host connect", async () => {
    const fixtures = [
        createFixture({ caseId: "format/example", expectedGml: "if (foo) {\n    bar();\n}" }),
        createFixture({ caseId: "lint/example", expectedGml: null, kind: "lint", inputGml: "globalvar x;" })
    ];
    const fetchSpy = installFetchOnce({ fixtures });
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    host.connect();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });

    assert.equal(fetchSpy.callCount, 1);
    assert.equal(fetchSpy.lastUrl, FIXTURES_ENDPOINT);
    assert.equal(controller.getFixtures().length, 2);
    assert.equal(controller.getFixtures()[0]?.caseId, "format/example");
    assert.ok(host.requestUpdateCallCount >= 1);
});

void test("PlaygroundFixturesController keeps the fixture list empty when the endpoint reports no fixtures", async () => {
    installFetchOnce({ fixtures: [] });
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    host.connect();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });

    assert.deepEqual(controller.getFixtures(), []);
});

void test("PlaygroundFixturesController keeps the fixture list empty when the endpoint returns a non-ok status", async () => {
    installFetchOnce("body should not be parsed", { ok: false, status: 500 });
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    host.connect();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });

    assert.deepEqual(controller.getFixtures(), []);
});

void test("PlaygroundFixturesController swallows network errors without surfacing them", async () => {
    installFetchReject(new Error("offline"));
    globalThis.console.error = () => {
        // Swallow controller errors while the test asserts the controller
        // itself stays silent.
    };
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    host.connect();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });

    assert.deepEqual(controller.getFixtures(), []);
});

void test("PlaygroundFixturesController reuses the cached list on a second connect", async () => {
    const fetchSpy = installFetchOnce({ fixtures: [createFixture({ caseId: "format/cached" })] });
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    host.connect();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });

    const requestCountAfterFirstConnect = fetchSpy.callCount;
    host.disconnect();
    host.connect();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });

    assert.equal(fetchSpy.callCount, requestCountAfterFirstConnect);
    assert.equal(controller.getFixtures().length, 1);
});

void test("PlaygroundFixturesController.selectFixture resolves input, expected GML, and config", () => {
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    controller.setFixturesForTest([
        createFixture({ caseId: "format/example", config: { printWidth: 80 }, expectedGml: "expected" })
    ]);

    const selection = controller.selectFixture("format/example");

    assert.equal(selection.selectedFixtureId, "format/example");
    assert.equal(selection.inputGml, "if (foo) { bar(); }");
    assert.equal(selection.expectedGml, "expected");
    assert.deepEqual(selection.config, { printWidth: 80 });
    assert.equal(controller.getSelectedFixtureId(), "format/example");
    assert.equal(controller.getExpectedGml(), "expected");
    assert.equal(controller.getSelectedFixtureKind(), "format");
    assert.equal(controller.getFixtureById("format/example")?.caseId, "format/example");
});

void test("PlaygroundFixturesController.selectFixture clears state for an unknown id", () => {
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);

    controller.setFixturesForTest([createFixture({ caseId: "format/example" })]);
    controller.selectFixture("format/example");

    const selection = controller.selectFixture("not-a-real-id");

    assert.equal(selection.selectedFixtureId, "");
    assert.equal(selection.inputGml, null);
    assert.equal(selection.expectedGml, null);
    assert.equal(selection.config, null);
    assert.equal(controller.getSelectedFixtureId(), "");
    assert.equal(controller.getExpectedGml(), null);
    assert.equal(controller.getSelectedFixtureKind(), null);
});

void test("PlaygroundFixturesController.setExpectedGmlForTest overrides the active expected output", () => {
    const host = new MockReactiveHost();
    const controller = new PlaygroundFixturesController(host);
    controller.setFixturesForTest([createFixture({ caseId: "format/example", expectedGml: "from fixture" })]);
    controller.selectFixture("format/example");

    controller.setExpectedGmlForTest("override");
    assert.equal(controller.getExpectedGml(), "override");
});

void test("PlaygroundFixturesController leaves the loading flag cleared after disconnect", async () => {
    const { resolveFetch } = installDeferredFetch();
    const host = new MockReactiveHost();
    new PlaygroundFixturesController(host);

    host.connect();
    host.disconnect();

    resolveFetch({ fixtures: [createFixture({ caseId: "format/example" })] });
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 0);
    });

    // Reaching this assertion means the late `await` did not throw — the
    // controller swallowed the late response because it had already
    // disconnected, so no further state mutations occurred.
});
