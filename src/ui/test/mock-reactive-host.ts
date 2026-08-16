import type { ReactiveController, ReactiveControllerHost } from "lit";

/** Minimal `ReactiveControllerHost` test double that fans lifecycle calls out to registered controllers. */
export class MockReactiveHost implements ReactiveControllerHost {
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

    public updated(): void {
        for (const controller of this.#controllers) {
            controller.hostUpdated?.();
        }
    }
}
