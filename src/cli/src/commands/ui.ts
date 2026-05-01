import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import * as UI from "../modules/ui/index.js";
import {
    type PlannedSurfaceSharedOptions,
    printPlannedSurfacePayload,
    reportUnsupportedPlannedSurfaceBackend,
    resolvePlannedSurfaceProjectContext
} from "./planned-ai-surface-shared.js";

function addUiSharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).addOption(createConfigOption()).option("--json", "Emit JSON output.");
}

export function createUiCommand(): Command {
    const command = applyStandardCommandOptions(new Command("ui")).description(
        "Inspect UI-facing configuration and planned UI actions."
    );

    const inspect = addUiSharedOptions(
        applyStandardCommandOptions(new Command("inspect")).description("Inspect UI configuration catalog.")
    );
    inspect.action(async function uiInspectAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        const context = await resolvePlannedSurfaceProjectContext(options).catch(() => null);
        const payload = await UI.createGraphVisualizationProjectConfigurationCatalog(context, {
            config: options.config
        });
        printPlannedSurfacePayload(
            {
                command: "ui inspect",
                payload
            },
            options.json === true
        );
    });

    const validate = addUiSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate UI checks.")
    );
    validate.action(function uiValidateAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        printPlannedSurfacePayload(
            {
                command: "ui validate",
                ok: true,
                payload: {
                    catalogBackend: "available",
                    mutationBackend: "unsupported_backend"
                }
            },
            options.json === true
        );
    });

    const preview = addUiSharedOptions(
        applyStandardCommandOptions(new Command("preview")).description("Preview UI workflow.")
    );
    preview.action(function uiPreviewAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend(
            "ui preview",
            options,
            "Interactive UI preview backend is not implemented.",
            [
                "Define UI server/launcher command in CLI modules/server or dedicated UI module.",
                "Wire transport endpoint discovery so MCP can invoke and track UI sessions."
            ]
        );
    });

    const scaffold = addUiSharedOptions(
        applyStandardCommandOptions(new Command("scaffold")).description("Scaffold UI templates.")
    );
    scaffold.action(function uiScaffoldAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        reportUnsupportedPlannedSurfaceBackend("ui scaffold", options, "UI scaffold backend is not implemented.", [
            "Define scaffold templates and write flow under @gmloop/refactor.",
            "Expose template parameter validation for MCP and CLI."
        ]);
    });

    command.addCommand(inspect);
    command.addCommand(validate);
    command.addCommand(preview);
    command.addCommand(scaffold);
    return command;
}
