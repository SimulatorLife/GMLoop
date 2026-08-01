import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planAssetRenames } from "../src/identifier-case/asset-renames/planner.js";
import { IdentifierCaseStyle } from "../src/identifier-case/options.js";

void describe("identifier case asset rename planning", () => {
    void it("throws when provided an unknown asset style", () => {
        assert.throws(
            () =>
                planAssetRenames({
                    projectIndex: { resources: {} },
                    assetStyle: "kebab" as any
                }),
            /invalid identifier case style/i
        );
    });

    void it("accepts recognized asset styles", () => {
        const result = planAssetRenames({
            projectIndex: { resources: {} },
            assetStyle: IdentifierCaseStyle.CAMEL
        });

        assert.deepStrictEqual(result, {
            operations: [],
            conflicts: [],
            renames: []
        });
    });

    void it("renames folder-backed sprite resources into a matching target directory", () => {
        const result = planAssetRenames({
            projectIndex: {
                resources: {
                    "sprites/sprPlayer/sprPlayer.yy": {
                        name: "sprPlayer",
                        resourceType: "GMSprite"
                    }
                }
            },
            assetStyle: IdentifierCaseStyle.SNAKE_LOWER
        });

        assert.deepStrictEqual(result.conflicts, []);
        assert.strictEqual(result.renames.length, 1);
        assert.strictEqual(result.renames[0].newResourcePath, "sprites/spr_player/spr_player.yy");
    });
});
