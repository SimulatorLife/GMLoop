import { mock } from "node:test";

import { withTemporaryProperty } from "./temporary-property.js";

/**
 * Captured `console.error` messages and `process.exit` codes observed while
 * running an action. Returned by {@link captureCliErrorOutput} so tests can
 * assert against CLI error output without re-implementing the mock setup.
 */
export interface CapturedCliErrorOutput {
    /** Lines written to `console.error` while the action ran. */
    readonly logged: ReadonlyArray<string>;
    /** Exit codes passed to `process.exit`, in invocation order. */
    readonly exitCodes: ReadonlyArray<number | undefined>;
}

/**
 * Run an action while capturing `console.error` output and `process.exit`
 * codes. The mocked `process.exit` records the code and throws a synthetic
 * error so the command under test halts deterministically; callers wrap the
 * action in `assert.rejects` to assert against that synthetic error.
 *
 * Both mocks are restored before the helper resolves, even when the action
 * throws.
 */
export async function captureCliErrorOutput<Result>(
    run: () => Result | Promise<Result>
): Promise<CapturedCliErrorOutput> {
    const logged: string[] = [];
    const exitCodes: Array<number | undefined> = [];

    const restoreConsole = mock.method(console, "error", (...args) => {
        logged.push(args.join(" "));
    });

    try {
        await withTemporaryProperty(
            process,
            "exit",
            (code?: number) => {
                exitCodes.push(code);
                throw new Error(`process.exit called with code ${code ?? "undefined"}`);
            },
            run
        );
    } finally {
        restoreConsole.mock.restore();
    }

    return { logged, exitCodes };
}
