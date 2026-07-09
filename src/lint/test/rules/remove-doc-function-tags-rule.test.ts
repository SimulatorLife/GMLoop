import assert from "node:assert/strict";
import { test } from "node:test";

import * as LintWorkspace from "@gmloop/lint";

import { runGmlRule } from "./rule-test-harness.js";

function runRemoveDocFunctionTagsRule(code: string): { messageCount: number; output: string } {
    return runGmlRule({
        rule: LintWorkspace.Lint.plugin.rules["remove-doc-function-tags"],
        code,
        programNode: { type: "Program" }
    });
}

void test("remove-doc-function-tags removes top-level legacy function markers", () => {
    const input = ["/// @function update_player", "/// @param speed", "function update_player(speed) {}"].join("\n");

    const result = runRemoveDocFunctionTagsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(result.output, ["/// @param speed", "function update_player(speed) {}"].join("\n"));
});

void test("remove-doc-function-tags removes indented markers before local static function docs", () => {
    const input = [
        "function Player() constructor {",
        "    /// @override",
        "    /// @function step(_state)",
        "    /// @param state",
        "    /// @returns {undefined}",
        "    static step = function(_state) {};",
        "}"
    ].join("\n");

    const result = runRemoveDocFunctionTagsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(
        result.output,
        [
            "function Player() constructor {",
            "    /// @override",
            "    /// @param state",
            "    /// @returns {undefined}",
            "    static step = function(_state) {};",
            "}"
        ].join("\n")
    );
});

void test("remove-doc-function-tags preserves neighboring doc metadata and custom tags", () => {
    const input = [
        "/// @desc Create player state.",
        "/// @custom keep",
        "/// @function create_player",
        "/// @param name",
        "/// @returns {Struct.Player}",
        "function create_player(name) {}"
    ].join("\n");

    const result = runRemoveDocFunctionTagsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(
        result.output,
        [
            "/// @desc Create player state.",
            "/// @custom keep",
            "/// @param name",
            "/// @returns {Struct.Player}",
            "function create_player(name) {}"
        ].join("\n")
    );
});

void test("remove-doc-function-tags ignores ordinary comments and non-doc text", () => {
    const input = [
        "// @function ordinary comments stay",
        'var text = "/// @function text stays";',
        "/// @functional custom tag stays",
        "function demo() {}"
    ].join("\n");

    const result = runRemoveDocFunctionTagsRule(input);

    assert.equal(result.messageCount, 0);
    assert.equal(result.output, input);
});

void test("remove-doc-function-tags preserves CRLF line endings", () => {
    const input = ["/// @function bake", "/// @param value", "function bake(value) {}"].join("\r\n");

    const result = runRemoveDocFunctionTagsRule(input);

    assert.equal(result.messageCount, 1);
    assert.equal(result.output, ["/// @param value", "function bake(value) {}"].join("\r\n"));
});

void test("remove-doc-function-tags converges after one autofix pass", () => {
    const input = ["/// @function bake", "/// @param value", "function bake(value) {}"].join("\n");

    const firstPass = runRemoveDocFunctionTagsRule(input);
    const secondPass = runRemoveDocFunctionTagsRule(firstPass.output);

    assert.equal(firstPass.messageCount, 1);
    assert.equal(secondPass.messageCount, 0);
    assert.equal(secondPass.output, firstPass.output);
});
