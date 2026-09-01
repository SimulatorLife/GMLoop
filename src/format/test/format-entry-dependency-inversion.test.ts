import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { Options as PrettierOptions } from "prettier";

import { defaultGmlFormatProvider, type GmlFormatProvider } from "../src/components/index.js";
import { createGmlFormat, Format } from "../src/format-entry.js";

void test("format entry consumes the abstract provider instead of concrete formatter adapters", async () => {
    const source = await readFile(new URL("../../src/format-entry.ts", import.meta.url), "utf8");

    assert.doesNotMatch(source, /from "\.\/?(?:parsers|printer|comments)\//);
    assert.doesNotMatch(source, /import\s+prettier\b/u, "format-entry must not import the concrete Prettier runtime");
    assert.match(source, /from "\.\/components\/index\.js"/);
    assert.match(source, /GmlFormatProvider/, "format-entry should depend on the provider abstraction");
    assert.match(source, /provider\.formatSource/u, "format-entry should invoke the formatter through its provider");
});

void test("createGmlFormat wires components, runtime formatting, and normalization from its provider", async () => {
    const normalizeFormattedOutput = (formatted: string) => `normalized:${formatted}`;
    let capturedSource: string | undefined;
    let capturedOptions: PrettierOptions | undefined;
    const formatSource: GmlFormatProvider["formatSource"] = async (source, options) => {
        capturedSource = source;
        capturedOptions = options;
        return "formatted-by-provider";
    };
    const provider: GmlFormatProvider = {
        components: defaultGmlFormatProvider.components,
        prettierDefaults: {
            ...defaultGmlFormatProvider.prettierDefaults,
            printWidth: 72
        },
        formatSource,
        normalizeFormattedOutput
    };

    const plugin = createGmlFormat(provider);
    const formatted = await plugin.format("raw source", { printWidth: 91 });

    assert.notStrictEqual(plugin, Format, "factory should create an injected plugin instance");
    assert.strictEqual(plugin.parsers, provider.components.parsers);
    assert.strictEqual(plugin.printers, provider.components.printers);
    assert.strictEqual(plugin.options, provider.components.options);
    assert.strictEqual(formatted, "formatted-by-provider");
    assert.strictEqual(capturedSource, "raw source");
    assert.ok(capturedOptions);
    assert.strictEqual(capturedOptions.parser, "gml-parse");
    assert.strictEqual(capturedOptions.printWidth, 91);
    assert.deepStrictEqual(capturedOptions.plugins, [plugin]);
    assert.strictEqual(plugin.normalizeFormattedOutput("output"), "normalized:output");
    assert.strictEqual(plugin.defaultOptions?.printWidth, 72);
    assert.ok(Object.isFrozen(plugin), "injected plugin should be immutable after construction");
});
