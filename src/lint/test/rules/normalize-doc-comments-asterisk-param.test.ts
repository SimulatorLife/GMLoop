import { test } from "node:test";

import { assertEquals } from "../assertions.js";
import { lintWithRule } from "./lint-rule-test-harness.js";

void test("normalize-doc-comments handles asterisk-prefixed optional parameters, preventing duplicates", () => {
    const input = [
        "/// @function scr_timeline_play",
        "/// @param {Resource.GMTimeline} timeline_to_play - A timeline asset index",
        "/// @param {Function} *func_callback - A function to call after the timeline has completed",
        "/// @returns {obj} timeline_controller",
        "function scr_timeline_play(timeline_to_play, func_callback) {",
        "    return 100;",
        "}",
        ""
    ].join("\n");

    const expected = [
        "/// @param {Resource.GMTimeline} timeline_to_play - A timeline asset index",
        "/// @param {Function} func_callback - A function to call after the timeline has completed",
        "/// @returns {obj} timeline_controller",
        "function scr_timeline_play(timeline_to_play, func_callback) {",
        "    return 100;",
        "}",
        ""
    ].join("\n");

    const result = lintWithRule("normalize-doc-comments", input, {});
    assertEquals(result.output, expected);
});
