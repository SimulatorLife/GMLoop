import assert from "node:assert/strict";
import test from "node:test";

import type { TemplateResult } from "lit";

import { GmJsonViewer } from "../src/app/components/primitives/gm-json-viewer.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmJsonViewer extends GmJsonViewer {
    public renderForTest(): unknown {
        return this.render();
    }
}

type TemplateResultWithValues = TemplateResult & {
    readonly values: readonly unknown[];
};

function isTemplateResult(value: unknown): value is TemplateResultWithValues {
    if (typeof value !== "object" || value === null) {
        return false;
    }

    return Array.isArray(Reflect.get(value, "strings")) && Array.isArray(Reflect.get(value, "values"));
}

/**
 * Walks a rendered Lit template tree (including nested template results
 * produced by sub-renders, as `GmJsonViewer` does per tree node) and
 * collects every function value it finds, in document order. Used to reach
 * the private `@click` handlers wired onto per-node and "collapse all"
 * toggle buttons without needing a real DOM.
 */
function collectClickHandlers(value: unknown, into: Array<() => void> = []): Array<() => void> {
    if (Array.isArray(value)) {
        for (const item of value) {
            collectClickHandlers(item, into);
        }
        return into;
    }
    if (typeof value === "function") {
        into.push(value as () => void);
        return into;
    }
    if (isTemplateResult(value)) {
        for (const templateValue of value.values) {
            collectClickHandlers(templateValue, into);
        }
        return into;
    }
    return into;
}

void test("GmJsonViewer renders a copy button seeded with the pretty-printed JSON for object values", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = { active: true, name: "Widget" };

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.match(rendered, /<gm-copy-button[\s\S]*class="gm-json-viewer__copy"/u);
    assert.match(rendered, /\.value=\{\n {2}"active": true,\n {2}"name": "Widget"\n\}/u);
    assert.match(rendered, /accessibleLabel=Copy JSON to clipboard/u);
    assert.match(rendered, /label=Copy JSON/u);
});

void test("GmJsonViewer accepts a raw JSON string and copies it verbatim", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = '{"a":1}';

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.match(rendered, /\.value=\{"a":1\}/u);
});

void test("GmJsonViewer renders object keys, string/number/boolean/null values, and brackets", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = { count: 2, enabled: false, label: "hi", missing: null };

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.match(rendered, /<span class="gm-json-viewer__key">"count"<\/span>/u);
    assert.match(rendered, /<span class="gm-json-viewer__number">2<\/span>/u);
    assert.match(rendered, /<span class="gm-json-viewer__boolean">false<\/span>/u);
    assert.match(rendered, /<span class="gm-json-viewer__string">"hi"<\/span>/u);
    assert.match(rendered, /<span class="gm-json-viewer__null">null<\/span>/u);
    assert.match(rendered, /<span class="gm-json-viewer__bracket">\{<\/span>/u);
});

void test("GmJsonViewer renders array entries by index without keys", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = ["first", "second"];

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.match(rendered, /<span class="gm-json-viewer__bracket">\[<\/span>/u);
    assert.doesNotMatch(rendered, /gm-json-viewer__key/u);
    assert.match(rendered, /"first"[\s\S]*"second"/u);
});

void test("GmJsonViewer renders empty objects and arrays without a toggle button", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = { emptyArray: [], emptyObject: {} };

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.match(rendered, /<span class="gm-json-viewer__bracket">\{\}<\/span>/u);
    assert.match(rendered, /<span class="gm-json-viewer__bracket">\[\]<\/span>/u);
});

void test("GmJsonViewer falls back to a raw text view when value is not valid JSON", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = "not json";

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.match(rendered, /<pre class="gm-json-viewer__raw">not json<\/pre>/u);
    assert.doesNotMatch(rendered, /gm-json-viewer__collapse-all/u);
    // The raw fallback still exposes a working copy button for the exact text.
    assert.match(rendered, /\.value=not json/u);
});

void test("GmJsonViewer treats an empty string value as non-JSON and copies an empty string", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = "";

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.match(rendered, /<pre class="gm-json-viewer__raw"><\/pre>/u);
});

void test("GmJsonViewer collapses and expands an individual node when its toggle is clicked", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = { nested: { inner: 1 } };

    const initial = renderTemplateValue(viewer.renderForTest());
    assert.match(initial, /"inner"/u);
    assert.match(initial, /aria-expanded="true"/u);

    // Document order: the "collapse all" toolbar button comes first, then the
    // root object's toggle, then the nested object's toggle.
    const handlers = collectClickHandlers(viewer.renderForTest());
    assert.equal(handlers.length, 3);
    const nestedToggleHandler = handlers[2];
    assert.equal(typeof nestedToggleHandler, "function");
    nestedToggleHandler();

    const afterCollapse = renderTemplateValue(viewer.renderForTest());
    assert.doesNotMatch(afterCollapse, /"inner"/u);
    assert.match(afterCollapse, /1 key/u);

    const handlersAfterCollapse = collectClickHandlers(viewer.renderForTest());
    handlersAfterCollapse[2]();

    const afterExpand = renderTemplateValue(viewer.renderForTest());
    assert.match(afterExpand, /"inner"/u);
});

void test('GmJsonViewer "Collapse all" / "Expand all" toggles every container at once', () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = { nested: { inner: 1 }, top: "value" };

    const initial = renderTemplateValue(viewer.renderForTest());
    assert.match(initial, />Collapse all</u);
    assert.match(initial, /"inner"/u);

    const collapseAllHandler = collectClickHandlers(viewer.renderForTest())[0];
    collapseAllHandler();

    const collapsed = renderTemplateValue(viewer.renderForTest());
    assert.match(collapsed, />Expand all</u);
    assert.doesNotMatch(collapsed, /"inner"/u);
    assert.doesNotMatch(collapsed, /"top"/u);

    const expandAllHandler = collectClickHandlers(viewer.renderForTest())[0];
    expandAllHandler();

    const expanded = renderTemplateValue(viewer.renderForTest());
    assert.match(expanded, />Collapse all</u);
    assert.match(expanded, /"inner"/u);
});

void test("GmJsonViewer compact mode omits the collapse-all toggle and hides the copy button label", () => {
    const viewer = new TestableGmJsonViewer();
    viewer.value = { a: 1 };
    viewer.compact = true;

    const rendered = renderTemplateValue(viewer.renderForTest());

    assert.doesNotMatch(rendered, /gm-json-viewer__collapse-all/u);
    assert.match(rendered, /<gm-copy-button[\s\S]*\?hideLabel=true/u);
});
