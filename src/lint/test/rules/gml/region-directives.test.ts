import assert from "node:assert/strict";
import { test } from "node:test";

import {
    collectRegionSourceLines,
    readRegionDirectiveType,
    resolveRegionDirectiveLineEnding
} from "../../../src/rules/gml/region-directives.js";

void test("collectRegionSourceLines preserves source offsets and line endings", () => {
    const lines = collectRegionSourceLines("#region Outer\r\nvalue = 1;\r\n#endregion Inner");

    assert.deepEqual(lines, [
        {
            start: 0,
            end: 15,
            content: "#region Outer",
            lineEnding: "\r\n"
        },
        {
            start: 15,
            end: 27,
            content: "value = 1;",
            lineEnding: "\r\n"
        },
        {
            start: 27,
            end: 43,
            content: "#endregion Inner",
            lineEnding: ""
        }
    ]);
});

void test("readRegionDirectiveType detects region directives with comments", () => {
    assert.equal(readRegionDirectiveType("#region This is my region"), "start");
    assert.equal(readRegionDirectiveType("    #endregion This is the closing part of the region"), "end");
    assert.equal(readRegionDirectiveType("// #endregion not a directive"), null);
    assert.equal(readRegionDirectiveType("#regions not a directive"), null);
});

void test("resolveRegionDirectiveLineEnding uses the first authored line ending", () => {
    assert.equal(resolveRegionDirectiveLineEnding(collectRegionSourceLines("#region\r\nvalue = 1;\n")), "\r\n");
    assert.equal(resolveRegionDirectiveLineEnding(collectRegionSourceLines("#region")), "\n");
});
