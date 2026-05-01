import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import {
    type PlannedSurfaceSharedOptions,
    reportUnsupportedPlannedSurfaceBackend
} from "./planned-ai-surface-shared.js";

function addProfileSharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).option("--json", "Emit JSON output.");
}

export function createProfileCommand(): Command {
    const command = applyStandardCommandOptions(new Command("profile")).description(
        "Collect and inspect runtime profiling traces."
    );

    const start = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("start")).description("Start profiling capture.")
    );
    start.action(function profileStartAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend("profile start", options, "Profile start backend is not implemented.", [
            "Add runtime profiling start integration in @gmloop/runtime-wrapper.",
            "Expose profile session lifecycle in @gmloop/cli modules/runtime."
        ]);
    });

    const stop = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("stop")).description("Stop profiling capture.")
    );
    stop.action(function profileStopAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend("profile stop", options, "Profile stop backend is not implemented.", [
            "Persist profile snapshots when capture sessions stop.",
            "Wire capture lifecycle state into runner/runtime command modules."
        ]);
    });

    const snapshot = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("snapshot")).description("Capture one profile snapshot.")
    );
    snapshot.action(function profileSnapshotAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "profile snapshot",
            options,
            "Profile snapshot backend is not implemented.",
            [
                "Add point-in-time metric collection in @gmloop/runtime-wrapper.",
                "Emit snapshot payload schema for MCP consumers."
            ]
        );
    });

    const compare = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("compare")).description("Compare profile sessions or snapshots.")
    );
    compare.action(function profileCompareAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "profile compare",
            options,
            "Profile compare backend is not implemented.",
            [
                "Implement baseline-vs-candidate profile diff metrics.",
                "Add deterministic profile comparison thresholds and output schema."
            ]
        );
    });

    const report = addProfileSharedOptions(
        applyStandardCommandOptions(new Command("report")).description("Render profile report output.")
    );
    report.action(function profileReportAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "profile report",
            options,
            "Profile report backend is not implemented.",
            [
                "Add report rendering from persisted profile metrics.",
                "Support report output targets for CLI and MCP usage."
            ]
        );
    });

    command.addCommand(start);
    command.addCommand(stop);
    command.addCommand(snapshot);
    command.addCommand(compare);
    command.addCommand(report);
    return command;
}
