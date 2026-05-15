import { spawn } from "node:child_process";

export type GameMakerCliInvocation = Readonly<{
    args: ReadonlyArray<string>;
    command: string;
}>;

export type GameMakerCliDelegationOptions = Readonly<{
    cwd: string;
    env: NodeJS.ProcessEnv;
    forwardedArguments: ReadonlyArray<string>;
    toolPath: string | null;
}>;

/**
 * Build the command candidates used to invoke the official GameMaker CLI.
 *
 * The CLI prefers an installed `gm-cli` executable and falls back to
 * `npx @gamemaker/gm-cli@latest` when no explicit tool path is configured.
 */
export function createGameMakerCliInvocationPlan(
    toolPath: string | null,
    forwardedArguments: ReadonlyArray<string>
): ReadonlyArray<GameMakerCliInvocation> {
    if (toolPath !== null) {
        return [{ args: [...forwardedArguments], command: toolPath }];
    }

    return [
        { args: [...forwardedArguments], command: "gm-cli" },
        { args: ["--yes", "@gamemaker/gm-cli@latest", ...forwardedArguments], command: "npx" }
    ];
}

/**
 * Delegate a command invocation to the official GameMaker CLI.
 */
export async function delegateGameMakerCliCommand(options: GameMakerCliDelegationOptions): Promise<number> {
    const invocationPlan = createGameMakerCliInvocationPlan(options.toolPath, options.forwardedArguments);
    return await delegateGameMakerCliInvocationAtIndex(invocationPlan, options, 0);
}

async function runGameMakerCliInvocation(
    invocation: GameMakerCliInvocation,
    options: GameMakerCliDelegationOptions
): Promise<number> {
    return await new Promise<number>((resolve, reject) => {
        const childProcess = spawn(invocation.command, [...invocation.args], {
            cwd: options.cwd,
            env: options.env,
            stdio: ["inherit", "pipe", "pipe"]
        });

        childProcess.stdout.setEncoding("utf8");
        childProcess.stdout.on("data", (chunk: string) => {
            process.stdout.write(chunk);
        });

        childProcess.stderr.setEncoding("utf8");
        childProcess.stderr.on("data", (chunk: string) => {
            process.stderr.write(chunk);
        });

        childProcess.on("error", reject);
        childProcess.on("close", (code, signal) => {
            if (signal !== null) {
                reject(new Error(`gm-cli exited due to signal ${signal}.`));
                return;
            }

            resolve(code ?? 1);
        });
    });
}

function isMissingCommandError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function delegateGameMakerCliInvocationAtIndex(
    invocationPlan: ReadonlyArray<GameMakerCliInvocation>,
    options: GameMakerCliDelegationOptions,
    index: number
): Promise<number> {
    const invocation = invocationPlan[index];

    if (invocation === undefined) {
        throw new Error(
            "Could not find the official GameMaker CLI. Install 'gm-cli' globally or ensure 'npx' is available."
        );
    }

    try {
        return await runGameMakerCliInvocation(invocation, options);
    } catch (error) {
        if (options.toolPath === null && invocation.command === "gm-cli" && isMissingCommandError(error)) {
            return await delegateGameMakerCliInvocationAtIndex(invocationPlan, options, index + 1);
        }

        throw error;
    }
}
