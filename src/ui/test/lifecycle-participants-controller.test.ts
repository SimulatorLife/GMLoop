import assert from "node:assert/strict";
import test from "node:test";

import type { ReactiveController, ReactiveControllerHost } from "lit";

import { LifecycleParticipantsController } from "../src/app/components/lifecycle-participants-controller.js";

class MockReactiveHost implements ReactiveControllerHost {
    #controllers: ReactiveController[] = [];
    public readonly updateComplete = Promise.resolve(true);

    public addController(controller: ReactiveController): void {
        this.#controllers.push(controller);
    }

    public removeController(controller: ReactiveController): void {
        this.#controllers = this.#controllers.filter((candidate) => candidate !== controller);
    }

    public requestUpdate(): void {}

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

void test("LifecycleParticipantsController connects participants in declaration order", () => {
    const host = new MockReactiveHost();
    const events: string[] = [];

    new LifecycleParticipantsController(host, [
        {
            connect: () => {
                events.push("first-connect");
            },
            disconnect: () => {
                events.push("first-disconnect");
            }
        },
        {
            connect: () => {
                events.push("second-connect");
            },
            disconnect: () => {
                events.push("second-disconnect");
            }
        }
    ]);

    host.connect();
    assert.deepEqual(events, ["first-connect", "second-connect"]);
});

void test("LifecycleParticipantsController disconnects participants in reverse declaration order", () => {
    const host = new MockReactiveHost();
    const events: string[] = [];

    new LifecycleParticipantsController(host, [
        {
            connect: () => {
                events.push("first-connect");
            },
            disconnect: () => {
                events.push("first-disconnect");
            }
        },
        {
            connect: () => {
                events.push("second-connect");
            },
            disconnect: () => {
                events.push("second-disconnect");
            }
        }
    ]);

    host.connect();
    host.disconnect();
    assert.deepEqual(events, ["first-connect", "second-connect", "second-disconnect", "first-disconnect"]);
});
