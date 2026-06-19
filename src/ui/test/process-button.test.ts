import assert from "node:assert/strict";
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
