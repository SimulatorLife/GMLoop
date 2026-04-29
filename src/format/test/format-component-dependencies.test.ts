import assert from "node:assert/strict";
import test from "node:test";

import {
    createDefaultGmlFormatComponents,
    defaultGmlFormatComponentImplementations
} from "../src/components/default-format-components.js";

const SAMPLE_SOURCE = "function example() { return 1; }";

void test("dependency bundle is frozen and exposes expected contract keys", () => {
    const dependencyBundle = defaultGmlFormatComponentImplementations;

    assert.ok(Object.isFrozen(dependencyBundle), "dependency bundle should be frozen");

    assert.deepStrictEqual(
        Object.keys(dependencyBundle).toSorted(),
        ["LogicalOperatorsStyle", "gmlParserAdapter", "handleComments", "print", "printComment"].toSorted()
    );
});

void test("default component factory wires the dependency bundle", async () => {
    const components = createDefaultGmlFormatComponents();

    const parser = components.parsers["gml-parse"];

    const dependencyBundle = defaultGmlFormatComponentImplementations;

    assert.strictEqual(
        parser,
        dependencyBundle.gmlParserAdapter,
        "gml-parse should reference the canonical parser adapter directly"
    );

    const parserResult = await parser.parse(SAMPLE_SOURCE, {
        originalText: SAMPLE_SOURCE
    } as any);
    const dependencyResult = await dependencyBundle.gmlParserAdapter.parse(SAMPLE_SOURCE, {
        originalText: SAMPLE_SOURCE
    } as any);

    assert.deepStrictEqual(parserResult, dependencyResult, "parser results should match the canonical parser adapter");
});

void test("default component factory exposes only the canonical parser id", () => {
    const components = createDefaultGmlFormatComponents();

    assert.deepStrictEqual(
        Object.keys(components.parsers),
        ["gml-parse"],
        "default parser map should avoid redundant aliases and expose only Prettier's canonical parser id"
    );
});
