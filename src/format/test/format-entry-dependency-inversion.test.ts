import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { defaultGmlFormatProvider, type GmlFormatProvider } from "../src/components/index.js";
import { createGmlFormat, Format } from "../src/format-entry.js";

void test("format entry consumes the abstract provider instead of low-level formatter adapters", async () => {
    const source = await readFile(new URL("../../src/format-entry.ts", import.meta.url), "utf8");

    // Verify high-level orchestration (format-entry.ts) does not directly
    // import concrete adapter subdirectories.
    assert.doesNotMatch(source, /from "\.\/?(?:parsers|printer|comments)\//);
    // Comment predicates must be supplied through the provider boundary rather
    // than imported by the high-level formatter composition module.
    const componentsSource = await readFile(
        new URL("../../src/components/default-format-components.ts", import.meta.url),
        "utf8"
    );
    assert.doesNotMatch(componentsSource, /from "@gmloop\/core"/);
    assert.match(source, /from "\.\/components\/index\.js"/);
    assert.match(source, /GmlFormatProvider/, "format-entry should depend on the provider abstraction");
});

void test("createGmlFormat wires parser, printer, option, and normalizer dependencies from its provider", () => {
    const normalizeFormattedOutput = (formatted: string) => `normalized:${formatted}`;
    const provider: GmlFormatProvider = {
        components: defaultGmlFormatProvider.components,
        prettierDefaults: {
            ...defaultGmlFormatProvider.prettierDefaults,
            printWidth: 72
        },
        normalizeFormattedOutput
    };

    const plugin = createGmlFormat(provider);

    assert.notStrictEqual(plugin, Format, "factory should create an injected plugin instance");
    assert.strictEqual(plugin.parsers, provider.components.parsers);
    assert.strictEqual(plugin.printers, provider.components.printers);
    assert.strictEqual(plugin.options, provider.components.options);
    assert.strictEqual(plugin.normalizeFormattedOutput("output"), "normalized:output");
    assert.strictEqual(plugin.defaultOptions?.printWidth, 72);
    assert.ok(Object.isFrozen(plugin), "injected plugin should be immutable after construction");
});
