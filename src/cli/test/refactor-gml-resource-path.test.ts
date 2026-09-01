import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isRefactorGmlSourcePath,
    isRefactorOwnerMetadataPath,
    isRefactorResourcePath
} from "../src/modules/refactor/gml-resource-path.js";

void describe("refactor resource path helpers", () => {
    void it("accepts .gml and .yy paths case-insensitively", () => {
        assert.equal(isRefactorResourcePath("scripts/player_step.gml"), true);
        assert.equal(isRefactorResourcePath("objects/o_player/o_player.YY"), true);
    });

    void it("rejects non-refactor extensions and blank paths", () => {
        assert.equal(isRefactorResourcePath("objects/o_player/sprite.png"), false);
        assert.equal(isRefactorResourcePath("   \t"), false);
    });

    void it("only treats .yy files as owner metadata paths", () => {
        assert.equal(isRefactorOwnerMetadataPath("objects/o_player/o_player.yy"), true);
        assert.equal(isRefactorOwnerMetadataPath("scripts/player_step.gml"), false);
    });

    void it("only treats .gml files as source paths", () => {
        assert.equal(isRefactorGmlSourcePath("scripts/player_step.gml"), true);
        assert.equal(isRefactorGmlSourcePath("objects/o_player/o_player.yy"), false);
        assert.equal(isRefactorGmlSourcePath("MyGame.yyp"), false);
    });
});
