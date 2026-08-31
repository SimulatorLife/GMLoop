import assert from "node:assert/strict";
import test from "node:test";

import type { ReactiveController, ReactiveControllerHost } from "lit";

import { LogAutoScrollController } from "../src/app/components/log-auto-scroll-controller.js";

class MockReactiveHost implements ReactiveControllerHost {
    #controllers: ReactiveController[] = [];
    public readonly updateComplete = Promise.resolve(true);

    public addController(controller: ReactiveController): void {
        this.#controllers.push(controller);
    }

    public removeController(controller: ReactiveController): void {
        this.#controllers = this.#controllers.filter((candidate) => candidate !== controller);
    }

    public requestUpdate(): void {
        // Controller under test does not call requestUpdate.
    }

    /** Simulate Lit calling hostUpdate() immediately before re-rendering. */
    public simulateUpdate(): void {
        for (const controller of this.#controllers) {
            controller.hostUpdate?.();
        }
    }

    /** Simulate Lit calling hostUpdated() immediately after re-rendering. */
    public simulateUpdated(): void {
        for (const controller of this.#controllers) {
            controller.hostUpdated?.();
        }
    }
}

interface MockLogElement {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
}

function createMockLogElement(overrides: Partial<MockLogElement> = {}): MockLogElement {
    return { clientHeight: 100, scrollHeight: 100, scrollTop: 0, ...overrides };
}

void test("LogAutoScrollController scrolls a freshly rendered element to the bottom", () => {
    const host = new MockReactiveHost();
    const element = createMockLogElement();
    new LogAutoScrollController(host, { getElement: () => element as unknown as HTMLElement });

    host.simulateUpdate();
    element.scrollHeight = 400;
    host.simulateUpdated();

    assert.equal(element.scrollTop, 400);
});

void test("LogAutoScrollController keeps following the bottom as more log lines stream in", () => {
    const host = new MockReactiveHost();
    const element = createMockLogElement({ clientHeight: 100, scrollHeight: 200, scrollTop: 100 });
    new LogAutoScrollController(host, { getElement: () => element as unknown as HTMLElement });

    // Reader is pinned to the bottom (scrollTop + clientHeight === scrollHeight).
    host.simulateUpdate();
    element.scrollHeight = 350;
    host.simulateUpdated();

    assert.equal(element.scrollTop, 350);
});

void test("LogAutoScrollController does not yank a reader who scrolled up to review earlier output", () => {
    const host = new MockReactiveHost();
    const element = createMockLogElement({ clientHeight: 100, scrollHeight: 500, scrollTop: 0 });
    new LogAutoScrollController(host, { getElement: () => element as unknown as HTMLElement });

    // Reader is far from the bottom before this render.
    host.simulateUpdate();
    element.scrollHeight = 600;
    host.simulateUpdated();

    assert.equal(element.scrollTop, 0);
});

void test("LogAutoScrollController resumes auto-scroll once the reader scrolls back near the bottom", () => {
    const host = new MockReactiveHost();
    const element = createMockLogElement({ clientHeight: 100, scrollHeight: 500, scrollTop: 0 });
    new LogAutoScrollController(host, { getElement: () => element as unknown as HTMLElement });

    host.simulateUpdate();
    element.scrollHeight = 600;
    host.simulateUpdated();
    assert.equal(element.scrollTop, 0);

    // Reader scrolls back within the bottom-pin threshold.
    element.scrollTop = 590;
    host.simulateUpdate();
    element.scrollHeight = 700;
    host.simulateUpdated();

    assert.equal(element.scrollTop, 700);
});

void test("LogAutoScrollController is a no-op when the host has not rendered a log element yet", () => {
    const host = new MockReactiveHost();
    const element: MockLogElement | null = null;
    new LogAutoScrollController(host, { getElement: () => element as unknown as HTMLElement | null });

    assert.doesNotThrow(() => {
        host.simulateUpdate();
        host.simulateUpdated();
    });
});
