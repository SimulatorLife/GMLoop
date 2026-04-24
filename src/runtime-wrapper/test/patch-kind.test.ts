import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getPatchKindMetadata, getSupportedPatchKinds, isSupportedPatchKind } from "../src/runtime/patch-kind.js";

void describe("patch kind metadata", () => {
    void it("returns metadata for each supported patch kind", () => {
        assert.deepStrictEqual(getPatchKindMetadata("script"), {
            registryCollectionKey: "scripts",
            displayName: "Script"
        });
        assert.deepStrictEqual(getPatchKindMetadata("event"), {
            registryCollectionKey: "events",
            displayName: "Event"
        });
        assert.deepStrictEqual(getPatchKindMetadata("closure"), {
            registryCollectionKey: "closures",
            displayName: "Closure"
        });
    });

    void it("returns all supported patch kinds in canonical order", () => {
        assert.deepStrictEqual(getSupportedPatchKinds(), ["script", "event", "closure"]);
    });

    void it("identifies valid and invalid patch kind values", () => {
        assert.strictEqual(isSupportedPatchKind("script"), true);
        assert.strictEqual(isSupportedPatchKind("event"), true);
        assert.strictEqual(isSupportedPatchKind("closure"), true);
        assert.strictEqual(isSupportedPatchKind("unknown"), false);
    });
});
