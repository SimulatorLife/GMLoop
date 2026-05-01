import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import {
    type PlannedSurfaceSharedOptions,
    reportUnsupportedPlannedSurfaceBackend
} from "./planned-ai-surface-shared.js";

function addReplaySharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).option("--json", "Emit JSON output.");
}

export function createReplayCommand(): Command {
    const command = applyStandardCommandOptions(new Command("replay")).description(
        "Record and replay AI interactions."
    );

    const record = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("record")).description("Record a replay trace (planned backend).")
    );
    record.action(function replayRecordAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "replay record",
            options,
            "Replay recorder backend is not implemented.",
            [
                "Implement capture stream hooks in runtime/watch pipeline.",
                "Define persistent replay artifact schema for deterministic playback."
            ]
        );
    });

    const run = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("run")).description("Run a replay trace.")
    );
    run.action(function replayRunAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend("replay run", options, "Replay playback backend is not implemented.", [
            "Implement runtime playback adapter in @gmloop/runtime-wrapper.",
            "Expose playback lifecycle controls through @gmloop/cli modules/runtime."
        ]);
    });

    const compare = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("compare")).description("Compare replay outputs.")
    );
    compare.action(function replayCompareAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "replay compare",
            options,
            "Replay comparison backend is not implemented.",
            [
                "Define deterministic replay comparison schema.",
                "Store baseline and candidate replay artifacts for diffing."
            ]
        );
    });

    const assertCommand = addReplaySharedOptions(
        applyStandardCommandOptions(new Command("assert")).description("Assert replay expectations.")
    );
    assertCommand.action(function replayAssertAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "replay assert",
            options,
            "Replay assertion backend is not implemented.",
            ["Add assertion evaluation across replay artifacts.", "Expose assertion result payload for MCP."]
        );
    });

    command.addCommand(record);
    command.addCommand(run);
    command.addCommand(compare);
    command.addCommand(assertCommand);
    return command;
}
