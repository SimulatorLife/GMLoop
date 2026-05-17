import assert from "node:assert/strict";
import test from "node:test";

import { createProjectIndexBuildOptions } from "../src/project-index/bootstrap-descriptor.js";

void test("createProjectIndexBuildOptions stores explicit concurrency settings directly", () => {
    const options = createProjectIndexBuildOptions({
        concurrency: {
            gml: 3,
            gmlParsing: 5
        }
    });

    assert.deepEqual(options.concurrency, { gml: 3, gmlParsing: 5 });
});

void test("createProjectIndexBuildOptions stores parseGml directly without parserOverride shim", () => {
    const parseGml = (text: string) => ({ parsed: text.length > 0 });

    const options = createProjectIndexBuildOptions({ parseGml });

    assert.equal(options.parseGml, parseGml);
});

void test("createProjectIndexBuildOptions ignores legacy alias properties", () => {
    const options = createProjectIndexBuildOptions({
        logger: null,
        logMetrics: true
    });

    assert.equal(options.concurrency, undefined);
    assert.equal(options.parseGml, undefined);
});
