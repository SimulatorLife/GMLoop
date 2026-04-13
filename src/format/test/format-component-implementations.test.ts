import assert from "node:assert/strict";
import test from "node:test";

import { handleComments, printComment } from "../src/comments/index.js";
import { defaultGmlFormatComponentImplementations } from "../src/components/default-format-components.js";
import { LogicalOperatorsStyle } from "../src/options/logical-operators-style.js";
import { gmlParserAdapter } from "../src/parsers/index.js";
import { print } from "../src/printer/index.js";

void test("default implementation bundle is frozen and reuses canonical references", () => {
    assert.ok(Object.isFrozen(defaultGmlFormatComponentImplementations), "implementation bundle should be frozen");

    assert.strictEqual(defaultGmlFormatComponentImplementations.gmlParserAdapter, gmlParserAdapter);
    assert.strictEqual(defaultGmlFormatComponentImplementations.print, print);
    assert.strictEqual(defaultGmlFormatComponentImplementations.printComment, printComment);
    assert.strictEqual(defaultGmlFormatComponentImplementations.handleComments, handleComments);
    assert.strictEqual(defaultGmlFormatComponentImplementations.LogicalOperatorsStyle, LogicalOperatorsStyle);
});
