import assert from "node:assert/strict";
import test from "node:test";

import { computeViewportTransformCenteredOnNode } from "../src/graph/graph-viewport.js";

void test("computeViewportTransformCenteredOnNode centers target coordinates at current zoom", () => {
    const transform = computeViewportTransformCenteredOnNode({
        currentScale: 1.5,
        targetX: 100,
        targetY: 200,
        viewportHeight: 800,
        viewportWidth: 1000
    });

    assert.deepEqual(transform, {
        k: 1.5,
        x: 350,
        y: 100
    });
});

void test("computeViewportTransformCenteredOnNode normalizes invalid zoom scale to 1", () => {
    const transform = computeViewportTransformCenteredOnNode({
        currentScale: Number.NaN,
        targetX: 320,
        targetY: 180,
        viewportHeight: 720,
        viewportWidth: 1280
    });

    assert.deepEqual(transform, {
        k: 1,
        x: 320,
        y: 180
    });
});

void test("computeViewportTransformCenteredOnNode returns null when target coordinates are not finite", () => {
    const transform = computeViewportTransformCenteredOnNode({
        currentScale: 1,
        targetX: Number.POSITIVE_INFINITY,
        targetY: 0,
        viewportHeight: 600,
        viewportWidth: 800
    });

    assert.equal(transform, null);
});
