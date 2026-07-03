import assert from "node:assert/strict";
import test from "node:test";

import { isToolbarKeyboardShortcutTextEntryTarget } from "../src/app/components/gm-graph-toolbar.js";
import { createInitialGraphVisualizationUiState, reduceGraphVisualizationUiState } from "../src/app/state/reducer.js";

type ConstructorDescriptor = PropertyDescriptor | undefined;

function restoreGlobalConstructor(name: string, descriptor: ConstructorDescriptor): void {
    if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, name);
        return;
    }

    Object.defineProperty(globalThis, name, descriptor);
}

void test("reduceGraphVisualizationUiState with toggle-graph-view alternates between visual and json", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.activeGraphView, "visual");

    const toggled = reduceGraphVisualizationUiState(state, { type: "toggle-graph-view" });
    assert.equal(toggled.activeGraphView, "json");

    const toggledBack = reduceGraphVisualizationUiState(toggled, { type: "toggle-graph-view" });
    assert.equal(toggledBack.activeGraphView, "visual");
});

void test("reduceGraphVisualizationUiState with cycle-label-mode cycles through auto, always, hidden", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.labelMode, "auto");

    const always = reduceGraphVisualizationUiState(state, { type: "cycle-label-mode" });
    assert.equal(always.labelMode, "always");

    const hidden = reduceGraphVisualizationUiState(always, { type: "cycle-label-mode" });
    assert.equal(hidden.labelMode, "hidden");

    const autoAgain = reduceGraphVisualizationUiState(hidden, { type: "cycle-label-mode" });
    assert.equal(autoAgain.labelMode, "auto");
});

void test("reduceGraphVisualizationUiState with reset-defaults clears search query", () => {
    const stateWithSearch = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        searchQuery: "player object",
        type: "set-search-query"
    });
    assert.equal(stateWithSearch.searchQuery, "player object");

    const reset = reduceGraphVisualizationUiState(stateWithSearch, { type: "reset-defaults" });
    assert.equal(reset.searchQuery, "");
});

void test("reduceGraphVisualizationUiState with set-search-query updates searchQuery", () => {
    const state = createInitialGraphVisualizationUiState();
    const updated = reduceGraphVisualizationUiState(state, {
        searchQuery: "script_test",
        type: "set-search-query"
    });
    assert.equal(updated.searchQuery, "script_test");
});

void test("reduceGraphVisualizationUiState with navigate-page updates activePage", () => {
    const state = createInitialGraphVisualizationUiState();
    assert.equal(state.activePage, "graph");

    const docsPage = reduceGraphVisualizationUiState(state, { page: "docs", type: "navigate-page" });
    assert.equal(docsPage.activePage, "docs");

    const configPage = reduceGraphVisualizationUiState(docsPage, { page: "config", type: "navigate-page" });
    assert.equal(configPage.activePage, "config");

    const graphPage = reduceGraphVisualizationUiState(configPage, { page: "graph", type: "navigate-page" });
    assert.equal(graphPage.activePage, "graph");
});

void test("reduceGraphVisualizationUiState preserves non-reset fields on reset-defaults", () => {
    const state = reduceGraphVisualizationUiState(createInitialGraphVisualizationUiState(), {
        page: "docs",
        type: "navigate-page"
    });
    assert.equal(state.activePage, "docs");

    const reset = reduceGraphVisualizationUiState(state, { type: "reset-defaults" });
    assert.equal(reset.activePage, "docs");
    assert.equal(reset.activeGraphView, "visual");
    assert.equal(reset.labelMode, "auto");
    assert.equal(reset.searchQuery, "");
});

void test("isToolbarKeyboardShortcutTextEntryTarget returns true for text-entry controls", () => {
    const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
    const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
    const originalInput = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
    const originalTextArea = Object.getOwnPropertyDescriptor(globalThis, "HTMLTextAreaElement");
    const originalSelect = Object.getOwnPropertyDescriptor(globalThis, "HTMLSelectElement");

    class MockElement extends EventTarget {
        public readonly isContentEditable: boolean;

        public constructor(isContentEditable = false) {
            super();
            this.isContentEditable = isContentEditable;
        }
    }

    class MockInputElement extends MockElement {
        public readonly type: string;

        public constructor(type: string) {
            super();
            this.type = type;
        }
    }

    class MockTextAreaElement extends MockElement {}
    class MockSelectElement extends MockElement {}

    Object.defineProperty(globalThis, "Element", { configurable: true, value: MockElement });
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: MockElement });
    Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: MockInputElement });
    Object.defineProperty(globalThis, "HTMLTextAreaElement", { configurable: true, value: MockTextAreaElement });
    Object.defineProperty(globalThis, "HTMLSelectElement", { configurable: true, value: MockSelectElement });

    try {
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockInputElement("search")), true);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockInputElement("text")), true);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockTextAreaElement()), true);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockSelectElement()), true);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockElement(true)), true);
    } finally {
        restoreGlobalConstructor("Element", originalElement);
        restoreGlobalConstructor("HTMLElement", originalHTMLElement);
        restoreGlobalConstructor("HTMLInputElement", originalInput);
        restoreGlobalConstructor("HTMLTextAreaElement", originalTextArea);
        restoreGlobalConstructor("HTMLSelectElement", originalSelect);
    }
});

void test("isToolbarKeyboardShortcutTextEntryTarget returns false for non-text controls", () => {
    const originalElement = Object.getOwnPropertyDescriptor(globalThis, "Element");
    const originalHTMLElement = Object.getOwnPropertyDescriptor(globalThis, "HTMLElement");
    const originalInput = Object.getOwnPropertyDescriptor(globalThis, "HTMLInputElement");
    const originalTextArea = Object.getOwnPropertyDescriptor(globalThis, "HTMLTextAreaElement");
    const originalSelect = Object.getOwnPropertyDescriptor(globalThis, "HTMLSelectElement");

    class MockElement extends EventTarget {
        public readonly isContentEditable = false;
    }

    class MockInputElement extends MockElement {
        public readonly type: string;

        public constructor(type: string) {
            super();
            this.type = type;
        }
    }

    class MockTextAreaElement extends MockElement {}
    class MockSelectElement extends MockElement {}

    Object.defineProperty(globalThis, "Element", { configurable: true, value: MockElement });
    Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: MockElement });
    Object.defineProperty(globalThis, "HTMLInputElement", { configurable: true, value: MockInputElement });
    Object.defineProperty(globalThis, "HTMLTextAreaElement", { configurable: true, value: MockTextAreaElement });
    Object.defineProperty(globalThis, "HTMLSelectElement", { configurable: true, value: MockSelectElement });

    try {
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockInputElement("button")), false);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockInputElement("checkbox")), false);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new MockElement()), false);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(new EventTarget()), false);
        assert.equal(isToolbarKeyboardShortcutTextEntryTarget(null), false);
    } finally {
        restoreGlobalConstructor("Element", originalElement);
        restoreGlobalConstructor("HTMLElement", originalHTMLElement);
        restoreGlobalConstructor("HTMLInputElement", originalInput);
        restoreGlobalConstructor("HTMLTextAreaElement", originalTextArea);
        restoreGlobalConstructor("HTMLSelectElement", originalSelect);
    }
});

void test("isToolbarKeyboardShortcutTextEntryTarget returns true for targets with text-entry tagNames even without instanceof checks", () => {
    const dummyTargetInput = { tagName: "INPUT", type: "search" } as unknown as EventTarget;
    const dummyTargetTextArea = { tagName: "TEXTAREA" } as unknown as EventTarget;
    const dummyTargetSelect = { tagName: "SELECT" } as unknown as EventTarget;
    const dummyTargetButtonInput = { tagName: "INPUT", type: "button" } as unknown as EventTarget;

    assert.equal(isToolbarKeyboardShortcutTextEntryTarget(dummyTargetInput), true);
    assert.equal(isToolbarKeyboardShortcutTextEntryTarget(dummyTargetTextArea), true);
    assert.equal(isToolbarKeyboardShortcutTextEntryTarget(dummyTargetSelect), true);
    assert.equal(isToolbarKeyboardShortcutTextEntryTarget(dummyTargetButtonInput), false);
});
