import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    COMMANDER_HELP_CODES,
    isCommanderErrorLike,
    isCommanderExcessArgumentsError,
    isCommanderHelpDisplayedError,
    isCommanderHelpError,
    isCommanderHelpLikeError,
    parseCommanderExcessArgumentsMessage
} from "../src/cli-core/commander-error-utils.js";

void describe("commander error utils", () => {
    void it("recognizes commander-style errors by capability", () => {
        const error: Error & { code?: string; exitCode?: number } = new Error("bad option");
        error.code = "commander.invalidOption";
        error.exitCode = 2;

        assert.equal(isCommanderErrorLike(error), true);
        assert.equal(
            isCommanderErrorLike({
                message: "bad option",
                code: "commander.invalidOption"
            }),
            true
        );
        assert.equal(
            isCommanderErrorLike({
                message: "bad option",
                code: "ERR_GENERIC"
            }),
            false
        );
        assert.equal(
            isCommanderErrorLike({
                message: "bad option",
                code: "commander.invalidOption",
                exitCode: "2"
            }),
            false
        );
    });

    void it("identifies the commander.helpDisplayed error code", () => {
        const error: Error & { code?: string; exitCode?: number } = new Error("(outputHelp)");
        error.code = "commander.helpDisplayed";
        error.exitCode = 0;

        assert.equal(isCommanderHelpDisplayedError(error), true);
        assert.equal(isCommanderHelpLikeError(error), true);
        assert.equal(isCommanderHelpError(error), false);
    });

    void it("identifies the commander.help error code", () => {
        const error: Error & { code?: string; exitCode?: number } = new Error("(outputHelp)");
        error.code = "commander.help";
        error.exitCode = 1;

        assert.equal(isCommanderHelpError(error), true);
        assert.equal(isCommanderHelpLikeError(error), true);
        assert.equal(isCommanderHelpDisplayedError(error), false);
    });

    void it("does not flag unrelated commander error codes as help-like", () => {
        const error: Error & { code?: string; exitCode?: number } = new Error("bad option");
        error.code = "commander.invalidOption";
        error.exitCode = 2;

        assert.equal(isCommanderHelpLikeError(error), false);
        assert.equal(isCommanderHelpError(error), false);
        assert.equal(isCommanderHelpDisplayedError(error), false);
    });

    void it("exposes the canonical commander help code list", () => {
        assert.deepEqual([...COMMANDER_HELP_CODES], ["commander.helpDisplayed", "commander.help"]);
    });

    void it("identifies the commander.excessArguments error code", () => {
        const error: Error & { code?: string; exitCode?: number } = new Error(
            "error: too many arguments for 'format'. Expected 0 arguments but got 1: /tmp."
        );
        error.code = "commander.excessArguments";
        error.exitCode = 1;

        assert.equal(isCommanderExcessArgumentsError(error), true);
        assert.equal(isCommanderErrorLike(error), true);
        assert.equal(isCommanderHelpLikeError(error), false);
    });

    void it("parses a single excess argument message", () => {
        const result = parseCommanderExcessArgumentsMessage(
            "error: too many arguments for 'format'. Expected 0 arguments but got 1: /tmp."
        );
        assert.deepEqual(result, { commandName: "format", excessArguments: ["/tmp"] });
    });

    void it("parses multiple excess arguments from a comma-separated message", () => {
        const result = parseCommanderExcessArgumentsMessage(
            "error: too many arguments for 'fix'. Expected 0 arguments but got 2: /tmp, /var."
        );
        assert.deepEqual(result, { commandName: "fix", excessArguments: ["/tmp", "/var"] });
    });

    void it("returns empty data when the message is not an excess-arguments error", () => {
        const result = parseCommanderExcessArgumentsMessage("error: unknown option '--bad-flag'");
        assert.deepEqual(result, { commandName: null, excessArguments: [] });
    });
});
