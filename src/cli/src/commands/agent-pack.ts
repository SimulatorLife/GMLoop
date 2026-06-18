import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import * as AgentPack from "../modules/auto-game-agent-pack/index.js";
import { discoverProjectRoot, printProjectPayload } from "../workflow/project-root.js";

type AgentPackInitOptions = Readonly<{
    gitignore?: boolean;
    path?: string;
}>;

/** Initialize or update the Auto-Game agent pack in one GameMaker project. */
export async function runAgentPackInit(options: AgentPackInitOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({ explicitProjectPath: options.path });
    const result = await AgentPack.initializeAgentPack(projectRoot, {
        includeGitIgnore: options.gitignore !== false
    });
    printProjectPayload({
        command: "agent-pack init",
        ok: true,
        payload: {
            added: result.added,
            changed: result.changed,
            conflicts: result.conflicts,
            removed: result.removed,
            unchanged: result.unchanged,
            updated: result.updated,
            version: result.availableVersion
        },
        projectRoot: result.projectRoot
    });
}

/** Create the project-scoped Auto-Game agent-pack command family. */
export function createAgentPackCommand(): Command {
    const command = applyStandardCommandOptions(new Command("agent-pack")).description(
        "Manage the project-scoped Auto-Game agent pack."
    );
    const init = applyStandardCommandOptions(new Command("init"))
        .description("Initialize or update packaged Auto-Game skills and project guidance.")
        .addOption(createPathOption())
        .option("--no-gitignore", "Do not create or update the project-root .gitignore.");
    init.action(async function agentPackInitAction() {
        await runAgentPackInit(this.opts<AgentPackInitOptions>());
    });
    command.addCommand(init);
    return command;
}
