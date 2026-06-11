import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { PropertyValues, TemplateResult } from "lit";

import { GmCopyButton } from "../src/app/components/primitives/gm-copy-button.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmCopyButton extends GmCopyButton {
    public renderForTest(): unknown {
        return this.render();
    }

    public willUpdateForTest(changedProperties: PropertyValuesForTest): void {
        this.willUpdate(changedProperties as PropertyValues<this>);
    }
}

type PropertyValuesForTest = Map<PropertyKey, unknown>;

type TemplateResultWithValues = TemplateResult & {
    readonly values: readonly unknown[];
};

function isTemplateResult(value: unknown): value is TemplateResultWithValues {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}

function getClickHandler(rendered: unknown): () => void {
    if (!isTemplateResult(rendered)) {
        assert.fail("Expected a Lit template result.");
    }

    const handler = rendered.values.find((value): value is () => void => typeof value === "function");
    assert.equal(typeof handler, "function");
    return handler;
}

interface ClipboardHarness {
    writeTextCalls: string[];
    writeTextResult: Promise<void>;
    writeTextError: Error | null;
    restore: () => void;
}

function installClipboardMock(overrides: Partial<Omit<ClipboardHarness, "restore">> = {}): ClipboardHarness {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const writeTextCalls: string[] = [];
    const harness: ClipboardHarness = {
        writeTextCalls,
        writeTextError: null,
        writeTextResult: Promise.resolve(),
        ...overrides,
        restore: () => {
            if (originalDescriptor === undefined) {
                Reflect.deleteProperty(globalThis, "navigator");
                return;
            }
            Object.defineProperty(globalThis, "navigator", originalDescriptor);
        }
    };

    const fakeNavigator = {
        clipboard: {
            writeText: (value: string) => {
                writeTextCalls.push(value);
                if (harness.writeTextError) {
                    return Promise.reject(harness.writeTextError);
                }
                return harness.writeTextResult;
            }
        }
    };

    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: fakeNavigator
    });

    return harness;
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

void test("GmCopyButton renders a button with the default label and clipboard icon", () => {
    const button = new TestableGmCopyButton();
    button.value = '{"hello":"world"}';

    const rendered = renderTemplateValue(button.renderForTest());

    assert.match(rendered, /<button[\s\S]*class=gm-copy-button gm-copy-button--idle[\s\S]*type="button"/u);
    assert.match(rendered, /aria-label=Copy to clipboard/u);
    assert.match(rendered, /<span class="gm-copy-button__label">Copy to clipboard<\/span>/u);
    assert.match(rendered, /<rect x="9" y="9"/u);
    assert.doesNotMatch(rendered, /<polyline/u);
});

void test("GmCopyButton uses the configured label when no copy has happened yet", () => {
    const button = new TestableGmCopyButton();
    button.value = "payload";
    button.label = "Copy config JSON";

    const rendered = renderTemplateValue(button.renderForTest());

    assert.match(rendered, /aria-label=Copy config JSON/u);
    assert.match(rendered, /<span class="gm-copy-button__label">Copy config JSON<\/span>/u);
});

void test("GmCopyButton disables itself when the value is empty", () => {
    const button = new TestableGmCopyButton();

    const rendered = renderTemplateValue(button.renderForTest());

    // Lit renders a boolean attribute as `?disabled=true` (without quotes around `true`).
    assert.match(rendered, /<button[\s\S]*?class=gm-copy-button gm-copy-button--idle[\s\S]*\?disabled=true/u);
});

void test("GmCopyButton click writes the value through the Clipboard API and flips to success", async () => {
    const harness = installClipboardMock();
    try {
        const button = new TestableGmCopyButton();
        button.value = '{"a":1}';

        const clickHandler = getClickHandler(button.renderForTest());
        clickHandler();
        await flushMicrotasks();

        assert.deepEqual(harness.writeTextCalls, ['{"a":1}']);
        const after = renderTemplateValue(button.renderForTest());
        assert.match(after, /gm-copy-button--success/u);
        assert.match(after, /Copied/u);
        assert.match(after, /<polyline/u);
    } finally {
        harness.restore();
    }
});

void test("GmCopyButton surfaces the error state when the Clipboard API rejects", async () => {
    const harness = installClipboardMock({ writeTextError: new Error("permission denied") });
    try {
        const button = new TestableGmCopyButton();
        button.value = "data";

        const clickHandler = getClickHandler(button.renderForTest());
        clickHandler();
        await flushMicrotasks();

        const after = renderTemplateValue(button.renderForTest());
        assert.match(after, /gm-copy-button--error/u);
        assert.match(after, /Copy failed/u);
    } finally {
        harness.restore();
    }
});

void test("GmCopyButton falls back to a hidden textarea when navigator.clipboard is missing", async () => {
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");

    const appendedNodes: HTMLElement[] = [];
    const removedNodes: HTMLElement[] = [];
    const textarea: HTMLTextAreaElement = {
        remove: () => {
            removedNodes.push(textarea);
        },
        select: () => {
            /* mock */
        },
        setAttribute: () => {
            /* mock */
        },
        style: {} as CSSStyleDeclaration,
        value: ""
    } as unknown as HTMLTextAreaElement;

    const stubDocument = {
        body: {
            append: (node: Node) => {
                if (node === textarea) {
                    appendedNodes.push(textarea);
                }
            }
        },
        createElement: (tagName: string) => {
            if (tagName === "textarea") {
                return textarea;
            }
            return {} as HTMLElement;
        },
        execCommand: (command: string) => command === "copy"
    };

    Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {}
    });

    Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: stubDocument
    });

    try {
        const button = new TestableGmCopyButton();
        button.value = "fallback-value";
        const clickHandler = getClickHandler(button.renderForTest());
        clickHandler();
        await flushMicrotasks();

        assert.equal(textarea.value, "fallback-value");
        assert.equal(appendedNodes.length, 1);
        assert.equal(removedNodes.length, 1);

        const after = renderTemplateValue(button.renderForTest());
        assert.match(after, /gm-copy-button--success/u);
    } finally {
        if (originalNavigatorDescriptor === undefined) {
            Reflect.deleteProperty(globalThis, "navigator");
        } else {
            Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
        }
        if (originalDocumentDescriptor === undefined) {
            Reflect.deleteProperty(globalThis, "document");
        } else {
            Object.defineProperty(globalThis, "document", originalDocumentDescriptor);
        }
    }
});

void test("GmCopyButton returns to the idle label after the feedback window elapses", async () => {
    const harness = installClipboardMock();
    try {
        const button = new TestableGmCopyButton();
        button.value = "value";

        const clickHandler = getClickHandler(button.renderForTest());
        clickHandler();
        await flushMicrotasks();

        assert.match(renderTemplateValue(button.renderForTest()), /gm-copy-button--success/u);

        await new Promise((resolve) => {
            setTimeout(resolve, 1700);
        });

        assert.match(renderTemplateValue(button.renderForTest()), /gm-copy-button--idle/u);
        assert.doesNotMatch(renderTemplateValue(button.renderForTest()), /Copied/u);
    } finally {
        harness.restore();
    }
});

void test("GmCopyButton changing the value clears any in-flight feedback state", () => {
    const button = new TestableGmCopyButton();
    button.value = "first";

    button.willUpdateForTest(new Map<PropertyKey, unknown>([["value", ""]]));
    button.value = "next";

    const rendered = renderTemplateValue(button.renderForTest());
    assert.match(rendered, /gm-copy-button--idle/u);
    assert.doesNotMatch(rendered, /Copied/u);
});

void test("GmCopyButton exposes a polite live region describing the copy outcome", async () => {
    const harness = installClipboardMock();
    try {
        const button = new TestableGmCopyButton();
        button.value = "live-region-value";

        const rendered = renderTemplateValue(button.renderForTest());
        assert.match(rendered, /role="status" aria-live="polite"/u);

        const clickHandler = getClickHandler(button.renderForTest());
        clickHandler();
        await flushMicrotasks();

        const after = renderTemplateValue(button.renderForTest());
        assert.match(after, /role="status"[\s\S]*?aria-live="polite"[\s\S]*?characters copied to clipboard/u);
    } finally {
        harness.restore();
    }
});

void test("GmCopyButton uses touch-action: manipulation for mobile-safe taps", () => {
    // The CSS lives in primitives.css, so the test ensures the rule is present
    // and tied to the component so future style edits do not regress mobile usability.
    const stylesheet = readFileSync(new URL("../../src/web/styles/primitives.css", import.meta.url), "utf8");
    assert.match(stylesheet, /\.gm-copy-button\s*\{[\s\S]*touch-action:\s*manipulation/u);
    assert.match(stylesheet, /\.gm-copy-button\s*\{[\s\S]*min-height:\s*var\(--gm-height-xl\)/u);
});
