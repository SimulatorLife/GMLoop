import assert from "node:assert/strict";
import test from "node:test";

import {
    evaluateToolbarKeyboardShortcut,
    resolveKeyboardShortcutTarget,
    type ToolbarKeyboardShortcutContext
} from "../src/app/components/keyboard-shortcut-policy.js";

/**
 * Build a `ToolbarKeyboardShortcutContext` with sensible defaults so each
 * test only has to override the fields it cares about. Defaults reflect a
 * loaded graph index, no active search, no modifier, and a non-text target.
 */
function buildContext(overrides: Partial<ToolbarKeyboardShortcutContext> = {}): ToolbarKeyboardShortcutContext {
    return {
        canUseGraphControls: true,
        hasModifier: false,
        hasSearchQuery: false,
        isTextEntryTarget: false,
        key: "",
        ...overrides
    };
}

void test("evaluateToolbarKeyboardShortcut returns none for an empty key", () => {
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext()), { kind: "none" });
});

void test("evaluateToolbarKeyboardShortcut maps graph-scoped keys to their actions when graph controls are ready", () => {
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "g" })), { kind: "toggle-graph-view" });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "l" })), { kind: "cycle-label-mode" });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "r" })), { kind: "reset-defaults" });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "1" })), {
        kind: "navigate-page",
        page: "graph"
    });
});

void test("evaluateToolbarKeyboardShortcut normalises capital letters to lowercase before mapping", () => {
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "G" })), { kind: "toggle-graph-view" });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "L" })), { kind: "cycle-label-mode" });
});

void test("evaluateToolbarKeyboardShortcut maps number keys 2-7 to the matching top-level pages", () => {
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "2" })), {
        kind: "navigate-page",
        page: "docs"
    });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "3" })), {
        kind: "navigate-page",
        page: "config"
    });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "4" })), {
        kind: "navigate-page",
        page: "fix"
    });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "5" })), {
        kind: "navigate-page",
        page: "playground"
    });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "6" })), {
        kind: "navigate-page",
        page: "auto-game"
    });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "7" })), {
        kind: "navigate-page",
        page: "live-reload"
    });
});

void test("evaluateToolbarKeyboardShortcut returns none for unmapped keys", () => {
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "z" })), { kind: "none" });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "0" })), { kind: "none" });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "8" })), { kind: "none" });
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ key: "ArrowUp" })), { kind: "none" });
});

void test("evaluateToolbarKeyboardShortcut returns clear-search for Escape with an active search query", () => {
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ hasSearchQuery: true, key: "Escape" })), {
        kind: "clear-search"
    });
});

void test("evaluateToolbarKeyboardShortcut returns none for Escape without an active search query", () => {
    assert.deepEqual(evaluateToolbarKeyboardShortcut(buildContext({ hasSearchQuery: false, key: "Escape" })), {
        kind: "none"
    });
});

void test("evaluateToolbarKeyboardShortcut prioritises clear-search over modifier suppression", () => {
    assert.deepEqual(
        evaluateToolbarKeyboardShortcut(buildContext({ hasModifier: true, hasSearchQuery: true, key: "Escape" })),
        { kind: "clear-search" }
    );
    assert.deepEqual(
        evaluateToolbarKeyboardShortcut(buildContext({ hasSearchQuery: true, isTextEntryTarget: true, key: "Escape" })),
        { kind: "clear-search" }
    );
});

void test("evaluateToolbarKeyboardShortcut suppresses mapped actions when a modifier key is held", () => {
    for (const key of ["g", "l", "r", "1", "2", "3", "4", "5", "6", "7"]) {
        assert.deepEqual(
            evaluateToolbarKeyboardShortcut(buildContext({ hasModifier: true, key })),
            { kind: "none" },
            `modifier should suppress shortcut for key "${key}"`
        );
    }
});

void test("evaluateToolbarKeyboardShortcut suppresses mapped actions when the target is a text entry control", () => {
    for (const key of ["g", "l", "r", "1", "2", "3", "4", "5", "6", "7"]) {
        assert.deepEqual(
            evaluateToolbarKeyboardShortcut(buildContext({ isTextEntryTarget: true, key })),
            { kind: "none" },
            `text entry target should suppress shortcut for key "${key}"`
        );
    }
});

void test("evaluateToolbarKeyboardShortcut gates graph-scoped keys on the loaded index", () => {
    for (const key of ["g", "l", "r", "1"]) {
        assert.deepEqual(
            evaluateToolbarKeyboardShortcut(buildContext({ canUseGraphControls: false, key })),
            { kind: "none" },
            `graph-scoped shortcut "${key}" should be blocked when graph controls are not ready`
        );
    }
});

void test("evaluateToolbarKeyboardShortcut keeps page navigation available even when graph controls are not ready", () => {
    for (const [key, page] of [
        ["2", "docs"],
        ["3", "config"],
        ["4", "fix"],
        ["5", "playground"],
        ["6", "auto-game"],
        ["7", "live-reload"]
    ] as const) {
        assert.deepEqual(
            evaluateToolbarKeyboardShortcut(buildContext({ canUseGraphControls: false, key })),
            { kind: "navigate-page", page },
            `page navigation shortcut "${key}" should remain available when graph controls are not ready`
        );
    }
});

void test("resolveKeyboardShortcutTarget prefers the first composed-path entry when present", () => {
    const eventTarget = { tag: "eventTarget" } as unknown as EventTarget;
    const composedTarget = { tag: "composedTarget" } as unknown as EventTarget;
    const event = {
        composedPath: () => [composedTarget],
        target: eventTarget
    } as unknown as KeyboardEvent;

    assert.strictEqual(resolveKeyboardShortcutTarget(event), composedTarget);
});

void test("resolveKeyboardShortcutTarget falls back to event.target when composedPath is empty", () => {
    const eventTarget = { tag: "eventTarget" } as unknown as EventTarget;
    const event = {
        composedPath: () => [],
        target: eventTarget
    } as unknown as KeyboardEvent;

    assert.strictEqual(resolveKeyboardShortcutTarget(event), eventTarget);
});
