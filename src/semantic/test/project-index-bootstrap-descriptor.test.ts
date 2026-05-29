import assert from "node:assert/strict";
import test from "node:test";

import {
    createProjectIndexBuildOptions,
    createProjectIndexDescriptor,
    type ProjectIndexBuildOptions,
    type ProjectIndexConcurrencySettings
} from "../src/project-index/bootstrap-descriptor.js";

const parseGml = (text: string) => ({ parsed: text.length > 0 });

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

void test("createProjectIndexBuildOptions ignores non-object concurrency", () => {
    const options1 = createProjectIndexBuildOptions({ concurrency: null });
    assert.equal(options1.concurrency, undefined);

    const options2 = createProjectIndexBuildOptions({ concurrency: undefined });
    assert.equal(options2.concurrency, undefined);
});

void test("createProjectIndexBuildOptions ignores concurrency with non-positive integers", () => {
    const invalidCases: ProjectIndexConcurrencySettings[] = [
        { gml: 0, gmlParsing: 1 },
        { gml: -1, gmlParsing: 2 },
        { gml: 1.5, gmlParsing: 2 },
        { gml: 2, gmlParsing: -1 }
    ];

    for (const concurrency of invalidCases) {
        const options = createProjectIndexBuildOptions({ concurrency });
        assert.equal(options.concurrency, undefined);
    }

    const stringCase = { gml: "2", gmlParsing: 3 } as unknown;
    const options = createProjectIndexBuildOptions({ concurrency: stringCase as ProjectIndexConcurrencySettings });
    assert.equal(options.concurrency, undefined);
});

void test("createProjectIndexBuildOptions ignores non-function parseGml", () => {
    assert.equal(createProjectIndexBuildOptions({ parseGml: null }).parseGml, undefined);
    const nonFn = "not a function" as unknown;
    assert.equal(
        createProjectIndexBuildOptions({ parseGml: nonFn as ProjectIndexBuildOptions["parseGml"] }).parseGml,
        undefined
    );
    assert.equal(
        createProjectIndexBuildOptions({
            parseGml: { call: () => {} } as unknown as ProjectIndexBuildOptions["parseGml"]
        }).parseGml,
        undefined
    );
});

void test("createProjectIndexDescriptor ignores null buildOptions", () => {
    const d1 = createProjectIndexDescriptor({ buildOptions: null });
    assert.equal(d1.buildOptions, undefined);
});

void test("createProjectIndexDescriptor stores valid buildOptions", () => {
    const valid = createProjectIndexBuildOptions({ logMetrics: true });
    const d = createProjectIndexDescriptor({ buildOptions: valid });
    assert.deepEqual(d.buildOptions, valid);
});
