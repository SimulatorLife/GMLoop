import process from "node:process";

import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import { handleCliError } from "../cli-core/errors.js";
import { delegateGameMakerCliCommand } from "../modules/game-maker-cli/index.js";

type GameMakerCliCommandOptions = Readonly<{
    toolPath: string | null;
}>;

/**
 * Create the thin command wrapper that delegates to the official GameMaker CLI.
 */
export function createGameMakerCliCommand(): Command {
    const command = applyStandardCommandOptions(new Command("gm-cli"))
        .description("Delegate to the official GameMaker CLI instead of re-implementing GameMaker tooling in GMLoop.")
        .allowUnknownOption()
        .allowExcessArguments()
        .argument("<arguments...>", "Arguments to forward to the official gm-cli executable.")
        .option("--tool-path <path>", "Explicit path to the gm-cli executable to run.");

    command.addHelpText(
        "after",
        [
            "",
            "Examples:",
            "  pnpm dlx gmloop gm-cli manual read data structures",
            '  pnpm dlx gmloop gm-cli resourcetool eval "resource list"',
            "  pnpm dlx gmloop gm-cli compile --target=html5"
        ].join("\n")
    );

    command.action(async function gameMakerCliCommandAction(forwardedArguments: Array<string>) {
        const options = this.opts<GameMakerCliCommandOptions>();
        let exitCode = 0;

        try {
            exitCode = await delegateGameMakerCliCommand({
                cwd: process.cwd(),
                env: process.env,
                forwardedArguments,
                toolPath: options.toolPath
            });
        } catch (error) {
            handleCliError(error, {
                exitCode: 1,
                prefix: "GameMaker CLI delegation failed."
            });
        }

        if (exitCode !== 0) {
            process.exit(exitCode);
        }
    });

    return command;
}
