import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { debounce } from "../src/utils/function.js";

// `debounce` is timing-driven: it schedules a `setTimeout` whose callback
// triggers the wrapped function after the quiet period elapses. Validating
// that contract with real wall-clock waits is non-deterministic — the
// scheduled timer can race with the subsequent assertion under load — and
// inflates the suite by ~1 second of cumulative sleep. The contract under
// test is the debounce state machine, not the platform timer, so these
// tests drive the scheduler through `node:test`'s `mock.timers`. Every
// test enables and resets the mock in a `try/finally` so neighbouring
// cases cannot observe a leaking timer.
void describe("debounce", () => {
    void describe("basic debouncing", () => {
        void it("delays execution until the quiet period elapses", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn();
                assert.equal(callCount, 0, "callback must not run before the timer fires");

                mock.timers.tick(49);
                assert.equal(callCount, 0, "callback must not run before the delay elapses");

                mock.timers.tick(1);
                assert.equal(callCount, 1, "callback must run once the delay elapses");
            } finally {
                mock.timers.reset();
            }
        });

        void it("coalesces multiple rapid calls into a single execution", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn();
                debouncedFn();
                debouncedFn();
                debouncedFn();

                mock.timers.tick(50);

                assert.equal(callCount, 1, "rapid calls must be debounced to a single execution");
            } finally {
                mock.timers.reset();
            }
        });

        void it("uses the last set of arguments when the timer finally fires", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const calls: Array<string> = [];
                const debouncedFn = debounce((value: string) => {
                    calls.push(value);
                }, 50);

                debouncedFn("first");
                debouncedFn("second");
                debouncedFn("third");

                mock.timers.tick(50);

                assert.deepEqual(calls, ["third"], "only the last-queued arguments must be passed to the callback");
            } finally {
                mock.timers.reset();
            }
        });

        void it("preserves all argument types across the debounce window", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const calls: Array<[string, number, boolean]> = [];
                const debouncedFn = debounce((a: string, b: number, c: boolean) => {
                    calls.push([a, b, c]);
                }, 50);

                debouncedFn("hello", 42, true);
                debouncedFn("world", 99, false);

                mock.timers.tick(50);

                assert.deepEqual(calls, [["world", 99, false]], "callback must receive the last-queued argument tuple");
            } finally {
                mock.timers.reset();
            }
        });

        void it("treats the delay as a quiet window — calls inside it reset the timer", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn();
                mock.timers.tick(40);
                debouncedFn();
                mock.timers.tick(40);
                debouncedFn();
                mock.timers.tick(49);

                assert.equal(callCount, 0, "a call inside the quiet window must reset the timer");

                mock.timers.tick(1);
                assert.equal(callCount, 1, "the callback must run once the quiet window finally elapses");
            } finally {
                mock.timers.reset();
            }
        });
    });

    void describe("flush", () => {
        void it("runs the pending callback immediately and cancels the scheduled timer", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 100);

                debouncedFn();
                assert.equal(callCount, 0, "callback must not run before flush");

                debouncedFn.flush();
                assert.equal(callCount, 1, "flush must run the pending callback immediately");

                mock.timers.tick(200);
                assert.equal(callCount, 1, "the original timer must not fire a second time after flush");
            } finally {
                mock.timers.reset();
            }
        });

        void it("does nothing when no callback is pending", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn.flush();
                assert.equal(callCount, 0, "flush must be a no-op when nothing is pending");
            } finally {
                mock.timers.reset();
            }
        });

        void it("uses the last arguments when invoked via flush", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const calls: Array<string> = [];
                const debouncedFn = debounce((value: string) => {
                    calls.push(value);
                }, 100);

                debouncedFn("first");
                debouncedFn("second");
                debouncedFn.flush();

                assert.deepEqual(calls, ["second"], "flush must use the last-queued arguments");
            } finally {
                mock.timers.reset();
            }
        });

        void it("can be called repeatedly without scheduling a stale timer", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn();
                debouncedFn.flush();
                debouncedFn();
                debouncedFn.flush();

                assert.equal(callCount, 2, "each pending invocation must fire on its flush");
                assert.equal(debouncedFn.isPending(), false, "no stale timer should remain after repeated flushes");
            } finally {
                mock.timers.reset();
            }
        });
    });

    void describe("cancel", () => {
        void it("prevents the scheduled callback from running", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn();
                debouncedFn.cancel();

                mock.timers.tick(100);
                assert.equal(callCount, 0, "cancel must drop the pending callback entirely");
            } finally {
                mock.timers.reset();
            }
        });

        void it("does nothing when no callback is pending", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn.cancel();
                assert.equal(callCount, 0, "cancel must be a no-op when nothing is pending");
            } finally {
                mock.timers.reset();
            }
        });

        void it("allows a new call after cancel to schedule a fresh timer", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn();
                debouncedFn.cancel();
                debouncedFn();

                mock.timers.tick(50);
                assert.equal(callCount, 1, "the post-cancel call must run on its own timer");
            } finally {
                mock.timers.reset();
            }
        });
    });

    void describe("isPending", () => {
        void it("reports the pending state across the lifecycle", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const debouncedFn = debounce(() => {
                    // Empty callback — verifies the lifecycle state, not the body.
                }, 50);

                assert.equal(debouncedFn.isPending(), false, "starts in the idle state");
                debouncedFn();
                assert.equal(debouncedFn.isPending(), true, "becomes pending after invocation");
                mock.timers.tick(50);
                assert.equal(debouncedFn.isPending(), false, "returns to idle after the timer fires");
            } finally {
                mock.timers.reset();
            }
        });

        void it("returns to idle after flush", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const debouncedFn = debounce(() => {
                    // Empty callback — verifies the lifecycle state, not the body.
                }, 50);

                debouncedFn();
                debouncedFn.flush();
                assert.equal(debouncedFn.isPending(), false, "flush must clear the pending state");
            } finally {
                mock.timers.reset();
            }
        });

        void it("returns to idle after cancel", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const debouncedFn = debounce(() => {
                    // Empty callback — verifies the lifecycle state, not the body.
                }, 50);

                debouncedFn();
                debouncedFn.cancel();
                assert.equal(debouncedFn.isPending(), false, "cancel must clear the pending state");
            } finally {
                mock.timers.reset();
            }
        });
    });

    void describe("error handling", () => {
        void it("does not propagate synchronous errors from the wrapped callback", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const debouncedFn = debounce(() => {
                    throw new Error("Test error");
                }, 50);

                debouncedFn();
                assert.doesNotThrow(() => mock.timers.tick(50), "errors must not escape the timer callback");
            } finally {
                mock.timers.reset();
            }
        });

        void it("invokes the onError callback when the wrapped callback throws", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const errors: Array<unknown> = [];
                const debouncedFn = debounce(
                    () => {
                        throw new Error("Test error");
                    },
                    50,
                    {
                        onError: (error) => {
                            errors.push(error);
                        }
                    }
                );

                debouncedFn();
                mock.timers.tick(50);

                assert.equal(errors.length, 1, "onError must fire exactly once per execution");
                assert.ok(errors[0] instanceof Error, "onError must receive the thrown error");
                if (errors[0] instanceof Error) {
                    assert.equal(errors[0].message, "Test error", "error identity must be preserved");
                }
            } finally {
                mock.timers.reset();
            }
        });

        void it("invokes onError for each execution that throws", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const errors: Array<unknown> = [];
                const debouncedFn = debounce(
                    () => {
                        throw new Error("Test error");
                    },
                    30,
                    {
                        onError: (error) => {
                            errors.push(error);
                        }
                    }
                );

                debouncedFn();
                mock.timers.tick(30);
                debouncedFn();
                mock.timers.tick(30);

                assert.equal(errors.length, 2, "onError must fire once per execution, not once total");
            } finally {
                mock.timers.reset();
            }
        });

        void it("invokes onError when flush triggers an error", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const errors: Array<unknown> = [];
                const debouncedFn = debounce(
                    () => {
                        throw new Error("Flush error");
                    },
                    100,
                    {
                        onError: (error) => {
                            errors.push(error);
                        }
                    }
                );

                debouncedFn();
                debouncedFn.flush();

                assert.equal(errors.length, 1, "onError must fire when flush invokes a throwing callback");
                assert.ok(errors[0] instanceof Error, "onError must receive the thrown error");
            } finally {
                mock.timers.reset();
            }
        });

        void it("writes to stderr when no onError callback is provided", () => {
            const stderrOutput: Array<string> = [];
            const stderrWriteMock = mock.method(
                process.stderr,
                "write",
                (
                    chunk: string | Uint8Array,
                    encodingOrCallback?: BufferEncoding | ((error?: Error) => void),
                    callback?: (error?: Error) => void
                ): boolean => {
                    stderrOutput.push(String(chunk));
                    if (typeof encodingOrCallback === "function") {
                        encodingOrCallback();
                    } else if (callback !== undefined) {
                        callback();
                    }

                    return true;
                }
            );

            try {
                mock.timers.enable({ apis: ["setTimeout"] });
                try {
                    const debouncedFn = debounce(() => {
                        throw new Error("Test error");
                    }, 50);

                    debouncedFn();
                    mock.timers.tick(50);
                } finally {
                    mock.timers.reset();
                }

                assert.ok(stderrOutput.length > 0, "debounce must report the error to stderr when no onError is given");
                assert.ok(
                    stderrOutput.some((output) => output.includes("Test error")),
                    "stderr output must include the original error message"
                );
            } finally {
                stderrWriteMock.mock.restore();
            }
        });
    });

    void describe("edge cases", () => {
        void it("treats a zero delay as a real timer rather than executing synchronously", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 0);

                debouncedFn();
                assert.equal(callCount, 0, "even a zero-delay timer must not run synchronously");

                mock.timers.tick(0);
                assert.equal(callCount, 1, "the callback must run after the zero-delay timer fires");
            } finally {
                mock.timers.reset();
            }
        });

        void it("handles multiple sequential batches with independent timers", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 30);

                debouncedFn();
                debouncedFn();
                mock.timers.tick(30);
                assert.equal(callCount, 1, "first batch must run after its timer fires");

                debouncedFn();
                debouncedFn();
                mock.timers.tick(30);
                assert.equal(callCount, 2, "second batch must run after its independent timer fires");
            } finally {
                mock.timers.reset();
            }
        });

        void it("ignores calls that arrive inside the quiet window — the timer resets rather than re-arming", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                let callCount = 0;
                const debouncedFn = debounce(() => {
                    callCount += 1;
                }, 50);

                debouncedFn();
                mock.timers.tick(30);
                debouncedFn();
                mock.timers.tick(30);
                debouncedFn();

                mock.timers.tick(50);
                assert.equal(callCount, 1, "interleaved calls must still coalesce into a single execution");
            } finally {
                mock.timers.reset();
            }
        });
    });

    void describe("real-world scenarios", () => {
        void it("debounces a file-save handler so the same path is written once", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const savedFiles: Array<string> = [];
                const debouncedSave = debounce((filePath: string) => {
                    savedFiles.push(filePath);
                }, 200);

                debouncedSave("/path/file.gml");
                mock.timers.tick(50);
                debouncedSave("/path/file.gml");
                mock.timers.tick(50);
                debouncedSave("/path/file.gml");

                mock.timers.tick(200);

                assert.deepEqual(savedFiles, ["/path/file.gml"], "the file save must coalesce into a single call");
            } finally {
                mock.timers.reset();
            }
        });

        void it("flushes pending work on shutdown so the most recent args are processed", () => {
            mock.timers.enable({ apis: ["setTimeout"] });
            try {
                const processedFiles: Array<string> = [];
                const debouncedProcess = debounce((filePath: string) => {
                    processedFiles.push(filePath);
                }, 1000);

                debouncedProcess("/path/file1.gml");
                debouncedProcess("/path/file2.gml");

                debouncedProcess.flush();

                assert.deepEqual(
                    processedFiles,
                    ["/path/file2.gml"],
                    "shutdown flush must process the most recent pending call"
                );
            } finally {
                mock.timers.reset();
            }
        });
    });
});
