import assert from "node:assert/strict";
import test from "node:test";

import { GmlIdentifierOccurrenceIndex } from "../src/modules/refactor/gml-identifier-occurrence-index.js";

void test("GmlIdentifierOccurrenceIndex collects identifier ranges without matching string literals", () => {
    const index = GmlIdentifierOccurrenceIndex.fromSourceText(`foo();\nvar bar = foo;\nshow_debug_message("foo");\n`);

    assert.deepEqual(index.getOccurrences("foo"), [
        { start: 0, end: 3 },
        { start: 17, end: 20 }
    ]);
    assert.deepEqual(index.getOccurrences("bar"), [{ start: 11, end: 14 }]);
});

void test("GmlIdentifierOccurrenceIndex falls back to text scanning when parsing fails", () => {
    const index = GmlIdentifierOccurrenceIndex.fromSourceText(`foo(\n"foo"\nbar`);

    assert.deepEqual(index.getOccurrences("foo"), [{ start: 0, end: 3 }]);
    assert.deepEqual(index.getOccurrences("bar"), [{ start: 11, end: 14 }]);
});

void test("GmlIdentifierOccurrenceIndex normalizes AST identifier ends to exclusive ranges", () => {
    const sourceText = `instance_create_depth(0, 0, 0, oCamera);\nx = oCamera.camXfrom;\n`;
    const index = GmlIdentifierOccurrenceIndex.fromSourceText(sourceText);

    assert.deepEqual(index.getOccurrences("oCamera"), [
        { start: 31, end: 38 },
        { start: 45, end: 52 }
    ]);
    assert.deepEqual(index.getOccurrences("x"), [{ start: 41, end: 42 }]);
});

void test("GmlIdentifierOccurrenceIndex visits property values in structs (e.g. anonymous functions)", () => {
    const sourceText = `function my_event() {
        fsm.add("follow", {
            enter: function() {
                var local_var = my_global;
            },
            step: function() {
                if (instance_exists(oPlayer)) {
                    follow_id = oPlayer.id;
                }
            }
        });
    }`;
    const index = GmlIdentifierOccurrenceIndex.fromSourceText(sourceText);

    // It should find "oPlayer" inside the innermost function
    const oPlayerOccurrences = index.getOccurrences("oPlayer");
    assert.strictEqual(oPlayerOccurrences.length, 2);

    const instanceExistsOccurrences = index.getOccurrences("instance_exists");
    assert.strictEqual(instanceExistsOccurrences.length, 1);
});
