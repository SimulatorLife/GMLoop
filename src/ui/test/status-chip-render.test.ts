import assert from "node:assert/strict";
import test from "node:test";

import { GmStatusChip, type GmStatusChipStatus } from "../src/app/components/primitives/gm-status-chip.js";
import { renderTemplateValue } from "./render-template-helpers.js";

class TestableGmStatusChip extends GmStatusChip {
    public renderForTest(): unknown {
        return this.render();
    }
}

const STATUS_LABELS: ReadonlyArray<Readonly<{ label: string; status: GmStatusChipStatus }>> = Object.freeze([
    { label: "Not running", status: "not-running" },
    { label: "Running", status: "running" },
    { label: "Starting", status: "starting" },
    { label: "Stopped", status: "stopped" },
    { label: "Offline", status: "offline" },
    { label: "Error", status: "error" },
    { label: "Scanning", status: "scanning" }
]);

void test("GmStatusChip renders the closed set of supported status labels", () => {
    for (const { label, status } of STATUS_LABELS) {
        const chip = new TestableGmStatusChip();
        chip.status = status;

        const rendered = renderTemplateValue(chip.renderForTest());

        assert.match(rendered, new RegExp(`gm-status-chip--${status}`, "u"));
        assert.match(rendered, new RegExp(`Status: ${label}`, "u"));
        assert.match(rendered, new RegExp(`<strong>${label}</strong>`, "u"));
    }
});

void test("GmStatusChip falls back to not-running for invalid attribute values", () => {
    const chip = new TestableGmStatusChip();
    chip.status = "custom-text" as GmStatusChipStatus;

    const rendered = renderTemplateValue(chip.renderForTest());

    assert.match(rendered, /gm-status-chip--not-running/u);
    assert.match(rendered, /Status: Not running/u);
    assert.doesNotMatch(rendered, /custom-text/u);
});
