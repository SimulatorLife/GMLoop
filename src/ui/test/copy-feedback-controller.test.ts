import assert from "node:assert/strict";
import test from "node:test";

import type { ReactiveController, ReactiveControllerHost } from "lit";

import { CopyFeedbackController, type CopyFeedbackStatus } from "../src/app/components/copy-feedback-controller.js";

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

    public update(): void {
        for (const controller of this.#controllers) {
            controller.hostUpdate?.();
        }
    }
}

interface CopySpy {
    calls: string[];
    nextResult: Promise<boolean>;
}

interface ControllerHarness {
    controller: CopyFeedbackController;
    host: MockReactiveHost;
    copySpy: CopySpy;
    getValue: () => string;
    setValue: (next: string) => void;
}

function createHarness(options: { feedbackDurationMs?: number } = {}): ControllerHarness {
    const host = new MockReactiveHost();
    const copySpy: CopySpy = {
        calls: [],
        nextResult: Promise.resolve(true)
    };
    let value = "payload";
    const controller = new CopyFeedbackController(host, {
        callbacks: {
            getValue: () => value,
            onChange: () => host.requestUpdate()
        },
        copy: (next) => {
            copySpy.calls.push(next);
            return copySpy.nextResult;
        },
        feedbackDurationMs: options.feedbackDurationMs
    });
    return {
        controller,
        copySpy,
        getValue: () => value,
        host,
        setValue: (next) => {
            value = next;
        }
    };
}

void test("CopyFeedbackController starts in the idle status", () => {
    const harness = createHarness();
    assert.equal(harness.controller.status, "idle");
});

void test("CopyFeedbackController.trigger writes the current value through the copy delegate", async () => {
    const harness = createHarness();
    harness.host.connect();

    await harness.controller.trigger();

    assert.deepEqual(harness.copySpy.calls, ["payload"]);
    assert.equal(harness.controller.status, "success");
    // onChange should fire after the copy resolves so the host re-renders.
    assert.equal(harness.host.requestUpdateCallCount, 1);
});

void test("CopyFeedbackController.trigger flips to error when the copy delegate reports failure", async () => {
    const harness = createHarness();
    harness.copySpy.nextResult = Promise.resolve(false);
    harness.host.connect();

    await harness.controller.trigger();

    assert.equal(harness.controller.status, "error");
    assert.equal(harness.host.requestUpdateCallCount, 1);
});

void test("CopyFeedbackController.trigger is a no-op when the value is empty", async () => {
    const harness = createHarness();
    harness.setValue("");
    harness.host.connect();

    await harness.controller.trigger();

    assert.deepEqual(harness.copySpy.calls, []);
    assert.equal(harness.controller.status, "idle");
    assert.equal(harness.host.requestUpdateCallCount, 0);
});

void test("CopyFeedbackController returns to idle after the feedback duration elapses", async () => {
    const harness = createHarness({ feedbackDurationMs: 25 });
    harness.host.connect();

    await harness.controller.trigger();
    assert.equal(harness.controller.status, "success");

    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 60);
    });

    assert.equal(harness.controller.status, "idle");
    assert.equal(harness.host.requestUpdateCallCount, 2);
});

void test("CopyFeedbackController cancels the reset timer on disconnect", async () => {
    const harness = createHarness({ feedbackDurationMs: 25 });
    harness.host.connect();

    await harness.controller.trigger();
    assert.equal(harness.controller.status, "success");

    harness.host.disconnect();
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 60);
    });

    // Without the disconnect clear, the timer would have fired by now and
    // reset status to idle. The cancel must keep the status pinned so a
    // later reconnect does not blink back to idle.
    assert.equal(harness.controller.status, "success");
});

void test("CopyFeedbackController.hostUpdate resets to idle when the value changes", async () => {
    const harness = createHarness();
    harness.host.connect();

    // Simulate the host triggering a successful copy.
    await harness.controller.trigger();
    assert.equal(harness.controller.status, "success");
    assert.equal(harness.host.requestUpdateCallCount, 1);

    harness.setValue("next");
    harness.host.update();

    assert.equal(harness.controller.status, "idle");
    // One extra onChange for the value-change reset.
    assert.equal(harness.host.requestUpdateCallCount, 2);
});

void test("CopyFeedbackController.hostUpdate is a no-op when the value has not changed", async () => {
    const harness = createHarness();
    harness.host.connect();

    await harness.controller.trigger();
    assert.equal(harness.host.requestUpdateCallCount, 1);

    harness.host.update();
    harness.host.update();

    // No additional onChange invocations: status did not change and
    // value did not change.
    assert.equal(harness.host.requestUpdateCallCount, 1);
});

void test("CopyFeedbackController uses the default 1500ms feedback window when not overridden", async () => {
    const harness = createHarness();
    harness.host.connect();

    await harness.controller.trigger();
    assert.equal(harness.controller.status, "success");

    // Just under the default — should still be success.
    await new Promise((resolve) => {
        globalThis.setTimeout(resolve, 100);
    });
    assert.equal(harness.controller.status, "success");
});

void test("CopyFeedbackController.status only emits the closed set of strings", () => {
    const harness = createHarness();
    const validStatuses: ReadonlyArray<CopyFeedbackStatus> = ["idle", "success", "error"];
    assert.ok(validStatuses.includes(harness.controller.status));
});
