import type { ReactiveController, ReactiveControllerHost } from "lit";

/**
 * Behavior participant that can attach and detach itself from a host lifecycle.
 */
export interface LifecycleParticipant {
    connect(): void;
    disconnect(): void;
}

/**
 * Delegates host connection/disconnection to injected lifecycle participants.
 */
export class LifecycleParticipantsController implements ReactiveController {
    #participants: readonly LifecycleParticipant[];

    public constructor(host: ReactiveControllerHost, participants: readonly LifecycleParticipant[]) {
        this.#participants = [...participants];
        host.addController(this);
    }

    public hostConnected(): void {
        for (const participant of this.#participants) {
            participant.connect();
        }
    }

    public hostDisconnected(): void {
        for (const participant of this.#participants.toReversed()) {
            participant.disconnect();
        }
    }
}
