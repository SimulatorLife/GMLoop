import { randomUUID } from "node:crypto";
import type { FSWatcher, PathLike, WatchListener, WatchOptions } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { withTemporaryProperty } from "./temporary-property.js";

export interface WatchTestFixture {
    dir: string;
    script1: string;
    script2: string;
}

export type RetryTimerCounterState = {
    cleanupPhaseActive: boolean;
    retryTimersCreatedAfterCleanup: number;
};

export async function createWatchTestFixture(): Promise<WatchTestFixture> {
    const dir = path.join(process.cwd(), "tmp", `watch-test-${Date.now()}-${randomUUID()}`);

    await mkdir(dir, { recursive: true });

    const script1 = path.join(dir, "script1.gml");
    const script2 = path.join(dir, "script2.gml");

    await writeFile(script1, "var x = 10;", "utf8");
    await writeFile(script2, "var y = 20;", "utf8");

    return { dir, script1, script2 };
}

export async function disposeWatchTestFixture(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
}

export function createMockWatchFactory(listenerCapture?: {
    listener: WatchListener<string> | undefined;
}): (
    path: PathLike,
    options?: WatchOptions | BufferEncoding | "buffer",
    listener?: WatchListener<string>
) => FSWatcher {
    return (
        _path: PathLike,
        _options?: WatchOptions | BufferEncoding | "buffer",
        listener?: WatchListener<string>
    ): FSWatcher => {
        void _path;
        void _options;

        const capturedListener = listenerCapture;
        if (capturedListener) {
            capturedListener.listener = listener;
        }

        const watcher: FSWatcher = {
            close() {
                return undefined;
            },
            ref() {
                return this;
            },
            unref() {
                return this;
            },
            addListener() {
                return this;
            },
            on() {
                return this;
            },
            once() {
                return this;
            },
            removeListener() {
                return this;
            },
            off() {
                return this;
            },
            removeAllListeners() {
                return this;
            },
            setMaxListeners() {
                return this;
            },
            getMaxListeners() {
                return 0;
            },
            listeners() {
                return [];
            },
            rawListeners() {
                return [];
            },
            emit() {
                return false;
            },
            listenerCount() {
                return 0;
            },
            prependListener() {
                return this;
            },
            prependOnceListener() {
                return this;
            },
            eventNames() {
                return [];
            }
        };

        return watcher;
    };
}

/**
 * Create mutable state used by watch shutdown/timer-leak regression tests.
 */
export function createRetryTimerCounterState(): RetryTimerCounterState {
    return {
        cleanupPhaseActive: false,
        retryTimersCreatedAfterCleanup: 0
    };
}

/**
 * Snapshot and clear SIGTERM listeners so tests can emit SIGTERM safely.
 */
export function isolateSigtermListeners(): { restore: () => void } {
    const savedSigtermListeners = process.rawListeners("SIGTERM").slice();
    process.removeAllListeners("SIGTERM");

    return {
        restore: () => {
            for (const listener of savedSigtermListeners) {
                process.on("SIGTERM", listener as NodeJS.SignalsListener);
            }
        }
    };
}

/**
 * Temporarily wraps global setTimeout and counts retry-delay timers created
 * after cleanup begins.
 */
export async function withTrackedRetrySetTimeout<Result>(
    retryTimerCounterState: RetryTimerCounterState,
    retryDelayMs: number,
    action: () => Promise<Result>
): Promise<Result> {
    const originalSetTimeout = globalThis.setTimeout;

    return withTemporaryProperty(
        globalThis,
        "setTimeout",
        ((handler: (...args: Array<unknown>) => void, timeout?: number, ...args: Array<unknown>) => {
            const id = originalSetTimeout(handler, timeout, ...args);
            if (retryTimerCounterState.cleanupPhaseActive && timeout === retryDelayMs) {
                retryTimerCounterState.retryTimersCreatedAfterCleanup += 1;
            }
            return id;
        }) as typeof setTimeout,
        action
    );
}
