import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "@gmloop/core";

void test("bundled identifier metadata contains generator-owned canonical manual URLs", () => {
    const payload = Core.loadBundledIdentifierMetadata();
    assert.ok(Core.isObjectLike(payload));
    assert.ok(Core.isObjectLike(payload.identifiers));

    for (const [identifier, rawDescriptor] of Object.entries(payload.identifiers)) {
        assert.ok(Core.isObjectLike(rawDescriptor));
        const descriptor = rawDescriptor as Record<string, unknown>;
        if (typeof descriptor.manualPath !== "string") continue;

        assert.equal(typeof descriptor.manualUrl, "string", `${identifier} must store manualUrl beside manualPath`);
        const manualUrl = new URL(descriptor.manualUrl as string);
        assert.equal(manualUrl.origin, "https://manual.gamemaker.io");
        assert.equal(manualUrl.pathname, "/monthly/en/");

        const fragment = new URLSearchParams(manualUrl.hash.slice(1));
        assert.equal(fragment.get("rhsearch"), identifier);
        assert.equal(fragment.get("rhhlterm"), identifier);
        assert.equal(fragment.get("t"), descriptor.manualPath.endsWith(".htm") ? descriptor.manualPath : "Content.htm");
    }
});
