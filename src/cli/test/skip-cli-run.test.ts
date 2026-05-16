import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCliRunSkipped, SKIP_CLI_RUN_ENV_VAR } from "../src/shared/skip-cli-run.js";

void describe("skip-cli-run", () => {
    void it("returns false when the environment map is missing", () => {
        assert.equal(isCliRunSkipped(undefined), false);
        assert.equal(isCliRunSkipped(null), false);
    });

    void it("returns true only when the skip flag is exactly enabled", () => {
        assert.equal(isCliRunSkipped({ [SKIP_CLI_RUN_ENV_VAR]: "1" }), true);
        assert.equal(isCliRunSkipped({ [SKIP_CLI_RUN_ENV_VAR]: " 1 " }), true);
        assert.equal(isCliRunSkipped({ [SKIP_CLI_RUN_ENV_VAR]: "0" }), false);
        assert.equal(isCliRunSkipped({ [SKIP_CLI_RUN_ENV_VAR]: "" }), false);
    });
});
