import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MAX_ERROR_HISTORY_SIZE, DEFAULT_MAX_UNDO_STACK_SIZE } from "../browser/runtime/runtime-defaults.js";
import { createRuntimeWrapper } from "../browser/runtime/runtime-wrapper.js";

void test("DEFAULT_MAX_UNDO_STACK_SIZE is a positive integer", () => {
    assert.ok(Number.isInteger(DEFAULT_MAX_UNDO_STACK_SIZE));
    assert.ok(DEFAULT_MAX_UNDO_STACK_SIZE > 0, "default undo stack size must be positive");
});

void test("DEFAULT_MAX_ERROR_HISTORY_SIZE is a positive integer", () => {
    assert.ok(Number.isInteger(DEFAULT_MAX_ERROR_HISTORY_SIZE));
    assert.ok(DEFAULT_MAX_ERROR_HISTORY_SIZE > 0, "default error history size must be positive");
});

void test("createRuntimeWrapper uses DEFAULT_MAX_UNDO_STACK_SIZE when no override is provided", () => {
    const wrapper = createRuntimeWrapper();

    for (let i = 0; i < DEFAULT_MAX_UNDO_STACK_SIZE + 50; i++) {
        wrapper.applyPatch({
            kind: "script",
            id: `script:default-undo-${i}`,
            js_body: `return ${i};`
        });
    }

    assert.strictEqual(wrapper.getUndoStackSize(), DEFAULT_MAX_UNDO_STACK_SIZE);
});

void test("createRuntimeWrapper state records the resolved default options", () => {
    const wrapper = createRuntimeWrapper();

    assert.strictEqual(wrapper.state.options.maxUndoStackSize, DEFAULT_MAX_UNDO_STACK_SIZE);
    assert.strictEqual(wrapper.state.options.maxErrorHistorySize, DEFAULT_MAX_ERROR_HISTORY_SIZE);
});

void test("caller-supplied options still take precedence over the defaults", () => {
    const customUndoSize = 3;
    const customErrorSize = 7;
    const wrapper = createRuntimeWrapper({
        maxUndoStackSize: customUndoSize,
        maxErrorHistorySize: customErrorSize
    });

    assert.strictEqual(wrapper.state.options.maxUndoStackSize, customUndoSize);
    assert.strictEqual(wrapper.state.options.maxErrorHistorySize, customErrorSize);
});
