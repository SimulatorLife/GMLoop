import assert from "node:assert/strict";
import test from "node:test";

import { CopyFeedbackController, type CopyFeedbackStatus } from "../src/app/components/copy-feedback-controller.js";
import { MockReactiveHost } from "./mock-reactive-host.js";

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

void test("CopyFeedbackController returns to idle after the feedback duration elapses", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    try {
        const harness = createHarness({ feedbackDurationMs: 25 });
        harness.host.connect();

        await harness.controller.trigger();
        assert.equal(harness.controller.status, "success");

        context.mock.timers.tick(24);
        assert.equal(harness.controller.status, "success");

        context.mock.timers.tick(1);
        assert.equal(harness.controller.status, "idle");
        assert.equal(harness.host.requestUpdateCallCount, 2);
    } finally {
        context.mock.timers.reset();
    }
});

void test("CopyFeedbackController cancels the reset timer on disconnect", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    try {
        const harness = createHarness({ feedbackDurationMs: 25 });
        harness.host.connect();

        await harness.controller.trigger();
        assert.equal(harness.controller.status, "success");

        harness.host.disconnect();
        context.mock.timers.tick(25);

        assert.equal(harness.controller.status, "success");
        assert.equal(harness.host.requestUpdateCallCount, 1);
    } finally {
        context.mock.timers.reset();
    }
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

void test("CopyFeedbackController uses the default 1500ms feedback window when not overridden", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    try {
        const harness = createHarness();
        harness.host.connect();

        await harness.controller.trigger();
        assert.equal(harness.controller.status, "success");

        context.mock.timers.tick(1499);
        assert.equal(harness.controller.status, "success");

        context.mock.timers.tick(1);
        assert.equal(harness.controller.status, "idle");
    } finally {
        context.mock.timers.reset();
    }
});

void test("CopyFeedbackController.status only emits the closed set of strings", () => {
    const harness = createHarness();
    const validStatuses: ReadonlyArray<CopyFeedbackStatus> = ["idle", "success", "error"];
    assert.ok(validStatuses.includes(harness.controller.status));
});
