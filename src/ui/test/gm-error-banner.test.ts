import assert from "node:assert/strict";
import test from "node:test";

import { GmErrorBanner } from "../src/app/components/primitives/gm-error-banner.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmErrorBanner extends GmErrorBanner {
    public renderForTest(): unknown {
        return this.render();
    }
}

void test("GmErrorBanner renders nothing when message is empty", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "";

    const rendered = renderTemplateValue(banner.renderForTest());

    assert.equal(rendered, "");
});

void test("GmErrorBanner renders alert role and tabindex=-1", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "Something went wrong";

    const rendered = renderTemplateValue(banner.renderForTest());

    assert.match(rendered, /role="alert"/u);
    assert.match(rendered, /tabindex="-1"/u);
});

void test("GmErrorBanner displays the message text", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "Connection failed";

    const rendered = renderTemplateValue(banner.renderForTest());

    // Lit renders the text node directly; assert the span contains it (accounting for whitespace/newline variation)
    assert.match(rendered, /Connection failed/u);
});

void test("GmErrorBanner renders a dismiss button with custom aria-label", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "Error occurred";
    banner.dismissLabel = "Close error";

    const rendered = renderTemplateValue(banner.renderForTest());

    // Lit renders bare attribute (no quotes) for bound string values
    assert.match(rendered, /aria-label=Close error/u);
    assert.match(rendered, /gm-error-banner__dismiss/u);
});

void test("GmErrorBanner uses default dismiss label when not set", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "Error occurred";

    const rendered = renderTemplateValue(banner.renderForTest());

    // Lit renders bare attribute (no quotes) for bound string values
    assert.match(rendered, /aria-label=Dismiss/u);
});

void test("GmErrorBanner structural output is stable and contains expected element roles", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "Test message";
    banner.dismissLabel = "Dismiss";

    const rendered = renderTemplateValue(banner.renderForTest());

    // Structural assertions that are stable regardless of attribute quoting
    assert.match(rendered, /class="gm-error-banner" role="alert" tabindex="-1"/u);
    assert.match(rendered, /class="gm-error-banner__message"[^>]*>Test message/u);
    assert.match(rendered, /class="gm-error-banner__dismiss"/u);
    assert.match(rendered, /type="button"/u);
    // SVG close icon (X lines)
    assert.match(rendered, /<line x1="18" y1="6" x2="6" y2="18"/u);
    assert.match(rendered, /<line x1="6" y1="6" x2="18" y2="18"/u);
});

void test("GmErrorBanner empty message suppresses all rendering", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "";

    const rendered = renderTemplateValue(banner.renderForTest());

    assert.equal(rendered, "");
});

void test("GmErrorBanner non-empty message always renders the banner container", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "!";

    const rendered = renderTemplateValue(banner.renderForTest());

    assert.match(rendered, /gm-error-banner/u);
});

void test("GmErrorBanner dismiss button is a button element", () => {
    const banner = new TestableGmErrorBanner();
    banner.message = "Error";
    banner.dismissLabel = "Close";

    const rendered = renderTemplateValue(banner.renderForTest());

    assert.match(rendered, /<button[\s\S]*class="gm-error-banner__dismiss"[\s\S]*>[\s\S]*<\/button>/u);
});
