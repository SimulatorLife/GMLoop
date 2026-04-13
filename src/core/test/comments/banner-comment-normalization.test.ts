import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../../index.js";

void describe("normalizeBannerCommentText", () => {
    void it("remains stable across repeated calls for single-decoration banners", () => {
        const input = "---- Section";

        const first = Core.normalizeBannerCommentText(input);
        const second = Core.normalizeBannerCommentText(input);

        assert.strictEqual(first, "Section");
        assert.strictEqual(second, "Section");
    });
});
