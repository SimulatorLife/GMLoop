import assert from "node:assert/strict";
import test from "node:test";

import { GraphVisualizationUiStore } from "../src/app/state/store.js";

void test("subscriptions created during dispatch begin with the next state transition", () => {
    const store = new GraphVisualizationUiStore();
    let lateListenerNotifications = 0;
    const lateListener = (): void => {
        lateListenerNotifications += 1;
    };

    store.subscribe(() => {
        store.subscribe(lateListener);
    });

    store.dispatch({ searchQuery: "first", type: "set-search-query" });
    assert.equal(lateListenerNotifications, 0);

    store.dispatch({ searchQuery: "second", type: "set-search-query" });
    assert.equal(lateListenerNotifications, 1);
});
