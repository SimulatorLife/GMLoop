import assert from "node:assert/strict";
import test from "node:test";

import { waitForSemanticProjectWork } from "../../../src/project-index/project-service/lease-lifecycle.js";

void test("waitForSemanticProjectWork rejects with the original error-like rejection reason unchanged", async () => {
    // Regression: the rejection path previously used `error instanceof Error`
    // to decide whether to forward the original rejection reason or wrap it
    // in a generic `Error`. That check fails for error-like values that come
    // from another realm (e.g. a worker thread) and are not `instanceof
    // Error` in this realm despite exposing the same `message`/`name`
    // surface. Using the shared `Core.isErrorLike` capability probe instead
    // means any collaborator that satisfies the error-like contract is
    // forwarded as-is, regardless of which realm constructed it.
    const controller = new AbortController();
    const crossRealmError = Object.assign(Object.create(null), {
        name: "CrossRealmError",
        message: "worker thread failed"
    }) as Error;

    const result = waitForSemanticProjectWork(Promise.reject(crossRealmError), controller.signal);

    await assert.rejects(result, (error) => error === crossRealmError);
});

void test("waitForSemanticProjectWork wraps non-error-like rejection reasons", async () => {
    const controller = new AbortController();

    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- exercising a non-Error rejection reason on purpose.
    const result = waitForSemanticProjectWork(Promise.reject("plain string reason"), controller.signal);

    await assert.rejects(result, (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Shared semantic project work failed.");
        return true;
    });
});
