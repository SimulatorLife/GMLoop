import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createRefactorSubprocessMaxOldSpaceSizeArg,
    DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB,
    getRefactorSubprocessMaxOldSpaceSizeMb,
    REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR
} from "../src/shared/refactor-subprocess-memory.js";

void describe("refactor subprocess memory options", () => {
    void it("defaults to the configured heap size when no override is present", () => {
        assert.equal(getRefactorSubprocessMaxOldSpaceSizeMb({}), DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB);
    });

    void it("applies a valid environment override", () => {
        assert.equal(
            getRefactorSubprocessMaxOldSpaceSizeMb({
                [REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR]: "8192"
            }),
            8192
        );
    });

    void it("falls back to the default for a non-positive override", () => {
        assert.equal(
            getRefactorSubprocessMaxOldSpaceSizeMb({
                [REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR]: "0"
            }),
            DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB
        );
    });

    void it("falls back to the default for a non-numeric override", () => {
        assert.equal(
            getRefactorSubprocessMaxOldSpaceSizeMb({
                [REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR]: "not-a-number"
            }),
            DEFAULT_REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB
        );
    });

    void it("builds the Node --max-old-space-size flag from the resolved heap size", () => {
        assert.equal(
            createRefactorSubprocessMaxOldSpaceSizeArg({
                [REFACTOR_SUBPROCESS_MAX_OLD_SPACE_SIZE_MB_ENV_VAR]: "4096"
            }),
            "--max-old-space-size=4096"
        );
    });
});
