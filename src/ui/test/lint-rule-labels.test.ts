import assert from "node:assert/strict";
import test from "node:test";

import { getLintFixableBadgeLabel } from "../src/app/components/lint-rule-labels.js";

void test("getLintFixableBadgeLabel returns null for non-fixable rules", () => {
    assert.equal(getLintFixableBadgeLabel(null), null);
});

void test("getLintFixableBadgeLabel returns the canonical fixable label", () => {
    assert.equal(getLintFixableBadgeLabel("code"), "fixable");
});
