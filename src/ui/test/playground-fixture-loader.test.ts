import assert from "node:assert/strict";
import test from "node:test";

import { PlaygroundFixtureLoader } from "../src/app/components/playground-fixture-loader.js";

void test("PlaygroundFixtureLoader requests fixtures on connect", () => {
    let callCount = 0;
    const loader = new PlaygroundFixtureLoader({
        onLoadRequested: () => {
            callCount += 1;
        }
    });

    loader.connect();
    assert.equal(callCount, 1);
});

void test("PlaygroundFixtureLoader fires the load callback on every connect", () => {
    let callCount = 0;
    const loader = new PlaygroundFixtureLoader({
        onLoadRequested: () => {
            callCount += 1;
        }
    });

    loader.connect();
    loader.connect();
    loader.connect();
    assert.equal(callCount, 3);
});

void test("PlaygroundFixtureLoader disconnect does not invoke the load callback", () => {
    let callCount = 0;
    const loader = new PlaygroundFixtureLoader({
        onLoadRequested: () => {
            callCount += 1;
        }
    });

    loader.disconnect();
    assert.equal(callCount, 0);

    // A later connect after disconnect still fires so the host can re-hydrate.
    loader.connect();
    assert.equal(callCount, 1);
});

void test("PlaygroundFixtureLoader supports being reconnected after a disconnect", () => {
    let callCount = 0;
    const loader = new PlaygroundFixtureLoader({
        onLoadRequested: () => {
            callCount += 1;
        }
    });

    loader.connect();
    loader.disconnect();
    loader.connect();
    assert.equal(callCount, 2);
});
