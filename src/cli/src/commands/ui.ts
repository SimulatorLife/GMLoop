import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createConfigOption, createPathOption } from "../cli-core/shared-command-options.js";
import * as UI from "../modules/ui/index.js";
import {
    type PlannedSurfaceSharedOptions,
    printPlannedSurfacePayload,
    resolvePlannedSurfaceProjectContext
} from "./planned-ai-surface-shared.js";

function addUiSharedOptions(command: Command): Command {
    return command.addOption(createPathOption()).addOption(createConfigOption()).option("--json", "Emit JSON output.");
}

function printUiPayload(payload: unknown, options: PlannedSurfaceSharedOptions): void {
    printPlannedSurfacePayload(payload, options.json === true);
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
        printUiPayload(
            {
                command: "ui inspect",
                payload
            },
            options
        );
    });

    const validate = addUiSharedOptions(
        applyStandardCommandOptions(new Command("validate")).description("Validate UI checks.")
    );
    validate.action(function uiValidateAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        printUiPayload(
            {
                command: "ui validate",
                ok: true,
                payload: {
                    catalogBackend: "available",
                    mutationBackend: "not_available"
                }
            },
            options
        );
    });

    const preview = addUiSharedOptions(
        applyStandardCommandOptions(new Command("preview")).description("Preview UI workflow.")
    );
    preview.action(function uiPreviewAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        printUiPayload(
            {
                command: "ui preview",
                ok: true,
                payload: {
                    capability: "ui_preview_session",
                    state: "not_available"
                }
            },
            options
        );
    });

    const scaffold = addUiSharedOptions(
        applyStandardCommandOptions(new Command("scaffold")).description("Scaffold UI templates.")
    );
    scaffold.action(function uiScaffoldAction() {
        const options = this.opts<PlannedSurfaceSharedOptions>();
        printUiPayload(
            {
                command: "ui scaffold",
                ok: true,
                payload: {
                    capability: "ui_template_scaffold",
                    state: "not_available"
                }
            },
            options
        );
    });

    command.addCommand(inspect);
    command.addCommand(validate);
    command.addCommand(preview);
    command.addCommand(scaffold);
    return command;
}
