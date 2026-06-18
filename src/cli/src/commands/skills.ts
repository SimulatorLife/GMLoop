import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { createPathOption } from "../cli-core/shared-command-options.js";
import { initializeAutoGameProjectSkills } from "../modules/auto-game-skills/index.js";
import { discoverProjectRoot, printProjectPayload } from "../workflow/project-root.js";

type SkillsInitOptions = Readonly<{
    path?: string;
}>;

/** Initialize the standard Auto-Game skills in one GameMaker project. */
export async function runSkillsInit(options: SkillsInitOptions): Promise<void> {
    const projectRoot = await discoverProjectRoot({ explicitProjectPath: options.path });
    const result = await initializeAutoGameProjectSkills(projectRoot);
    printProjectPayload({
        command: "skills init",
        ok: true,
        payload: {
            copied: result.copied,
            skipped: result.skipped
        },
        projectRoot: result.projectRoot
    });
}

/** Create the project-scoped Agent Skills command family. */
export function createSkillsCommand(): Command {
    const command = applyStandardCommandOptions(new Command("skills")).description(
        "Manage project-scoped Agent Skills used by Auto-Game."
    );
    const init = applyStandardCommandOptions(new Command("init"))
        .description("Copy missing Auto-Game starter skills into a GameMaker project.")
        .addOption(createPathOption());
    init.action(async function skillsInitAction() {
        await runSkillsInit(this.opts<SkillsInitOptions>());
    });
    command.addCommand(init);
    return command;
}
