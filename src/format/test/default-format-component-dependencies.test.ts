import assert from "node:assert/strict";
import test from "node:test";

import { defaultGmlFormatComponentImplementations } from "../src/components/default-format-components.js";
import { LogicalOperatorsStyle } from "../src/options/logical-operators-style.js";
import { gmlParserAdapter } from "../src/parsers/index.js";
import { print } from "../src/printer/index.js";

const REQUIRED_KEYS = ["gmlParserAdapter", "print", "LogicalOperatorsStyle"];

void test("default dependency bundle exposes canonical components", () => {
    const resolved = defaultGmlFormatComponentImplementations;

    assert.ok(Object.isFrozen(resolved), "default dependency bundle should be frozen");

    assert.strictEqual(resolved.gmlParserAdapter, gmlParserAdapter);
    assert.strictEqual(resolved.print, print);
    assert.strictEqual(resolved.LogicalOperatorsStyle, LogicalOperatorsStyle);

    for (const key of REQUIRED_KEYS) {
        assert.ok(Object.hasOwn(resolved, key), `dependency bundle should expose ${key}`);
    }
});

void test("default dependency bundle maintains a stable reference", () => {
    const first = defaultGmlFormatComponentImplementations;
    const second = defaultGmlFormatComponentImplementations;

    assert.strictEqual(first, second, "default dependency bundle should be a shared singleton");
});
