import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GmButton, renderProcessButtonContent } from "../src/app/components/primitives/gm-button.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmButton extends GmButton {
    public renderForTest(): unknown {
        return this.render();
    }
}

void test("renderProcessButtonContent preserves the label and adds the shared spinner while pending", () => {
    const rendered = renderTemplateValue(renderProcessButtonContent({ label: "Initialize", pending: true }));

    assert.match(rendered, /class="button-spinner"[\s\S]*aria-hidden="true"/u);
    assert.match(rendered, /class=button-label[\s\S]*Initialize/u);
});

void test("renderProcessButtonContent keeps icon-only labels accessible without affecting layout", () => {
    const rendered = renderTemplateValue(
        renderProcessButtonContent({ label: "Start Live Reload", pending: false, visuallyHiddenLabel: true })
    );
    const stylesheet = readFileSync(new URL("../../src/web/styles/components.css", import.meta.url), "utf8");

    assert.match(rendered, /class=sr-only[\s\S]*Start Live Reload/u);
    assert.match(
        stylesheet,
        /\.sr-only\s*\{[\s\S]*position:\s*absolute;[\s\S]*width:\s*1px;[\s\S]*height:\s*1px;[\s\S]*overflow:\s*hidden;[\s\S]*white-space:\s*nowrap;/u
    );
});

void test("GmButton exposes native disabled and busy states while pending", () => {
    const button = new TestableGmButton();
    button.label = "Initialize";
    button.pending = true;

    const rendered = renderTemplateValue(button.renderForTest());

    assert.match(rendered, /class="gm-btn gm-button"/u);
    assert.match(rendered, /\?disabled=true/u);
    assert.match(rendered, /aria-busy=true/u);
    assert.match(rendered, /class="button-spinner"/u);
    assert.match(rendered, /Initialize/u);
});
