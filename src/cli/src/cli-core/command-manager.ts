import { Core } from "@gmloop/core";

import { DEFAULT_HELP_AFTER_ERROR } from "./command-standard-options.js";
import { resolveCommandUsage } from "./command-usage.js";
import {
    type CommanderCommandContract,
    type CommanderProgramContract,
    createCommanderCommandContract,
    createCommanderProgramContract,
    isCommanderCommandLike
} from "./commander-contract.js";
import { isCommanderErrorLike } from "./commander-error-utils.js";
import type { CommanderCommandLike, CommanderExecutor } from "./commander-types.js";
import { CliUsageError, handleCliError } from "./errors.js";

const { compactArray } = Core;

type CliCommandRunHandler = (context: { command: CommanderCommandLike }) => number | void | Promise<number | void>;

type CliCommandErrorHandler = (error: unknown, context: { command: CommanderCommandLike }) => void;

export interface CliCommandRegistrationOptions {
    command: CommanderCommandLike;
    run?: CliCommandRunHandler;
    onError?: CliCommandErrorHandler;
}

export interface CliCommandRegistry {
    registerDefaultCommand: (options: CliCommandRegistrationOptions) => CliCommandEntry;
    registerCommand: (options: CliCommandRegistrationOptions) => CliCommandEntry;
}

export interface CliCommandRunner {
    run: (argv: Array<string>) => Promise<void>;
}

interface CliCommandEntry {
    command: CommanderCommandLike;
    run: CliCommandRunHandler | null;
    handleError: CliCommandErrorHandler;
}

interface CliCommandManagerOptions {
    /**
     * Execution-focused Commander interface; avoids relying on legacy program aliases.
     */
    program: CommanderExecutor;
    onUnhandledError?: CliCommandErrorHandler;
}

interface ComposeUsageMessageOptions {
    defaultHelpText?: string;
    usage?: string | null | undefined;
}

function resolveContextCommandFromActionArgs(
    actionArgs: Array<unknown>,
    fallbackCommand: CommanderCommandLike
): CommanderCommandLike {
    const candidate = actionArgs.at(-1);
    return isCommanderCommandLike(candidate) ? candidate : fallbackCommand;
}

function composeUsageHelpMessage({ defaultHelpText, usage }: ComposeUsageMessageOptions): string | undefined {
    const sections = compactArray([defaultHelpText, usage ?? undefined]);
    return sections.length === 0 ? (usage ?? undefined) : sections.join("\n\n");
}

class CliCommandManager {
    private readonly _program: CommanderExecutor;
    private readonly _programContract: CommanderProgramContract;
    private readonly _entries: Set<CliCommandEntry> = new Set();
    private readonly _commandEntryLookup: WeakMap<CommanderCommandLike, CliCommandEntry> = new WeakMap();
    private _defaultCommandEntry: CliCommandEntry | null = null;
    private _activeCommand: CommanderCommandLike | null = null;
    private readonly _defaultErrorHandler: CliCommandErrorHandler;

    constructor({ program, onUnhandledError }: CliCommandManagerOptions) {
        const programContract = createCommanderProgramContract(program);

        this._program = programContract.raw;
        this._programContract = programContract;
        this._defaultErrorHandler =
            typeof onUnhandledError === "function"
                ? onUnhandledError
                : (error) =>
                      handleCliError(error, {
                          prefix: "Failed to run CLI command.",
                          exitCode: 1
                      });

        this._registerEntry(this._program, {
            handleError: this._defaultErrorHandler
        });

        this._programContract.hook("preSubcommand", (_thisCommand, actionCommand) => {
            if (actionCommand) {
                this._activeCommand = actionCommand;
            }
        });

        this._programContract.hook("postAction", () => {
            this._activeCommand = null;
        });
    }

    registerDefaultCommand({ command, run, onError }: CliCommandRegistrationOptions): CliCommandEntry {
        const entry = this._registerEntry(command, {
            run,
            handleError: onError,
            isDefault: true
        });
        this._programContract.addCommand(entry.command, { isDefault: true });
        return entry;
    }

    registerCommand({ command, run, onError }: CliCommandRegistrationOptions): CliCommandEntry {
        const entry = this._registerEntry(command, {
            run,
            handleError: onError
        });
        this._programContract.addCommand(entry.command);
        return entry;
    }

    async run(argv: Array<string>): Promise<void> {
        try {
            this._activeCommand = null;
            await this._programContract.parse(argv, { from: "user" });
        } catch (error) {
            if (this._handleCommanderError(error)) {
                return;
            }
            throw error;
        }
    }

    private _registerEntry(
        command: CommanderCommandLike,
        {
            run,
            handleError,
            isDefault = false
        }: {
            run?: CliCommandRunHandler;
            handleError?: CliCommandErrorHandler;
            isDefault?: boolean;
        } = {}
    ): CliCommandEntry {
        const commandContract: CommanderCommandContract = createCommanderCommandContract(command, {
            name: "Commander command",
            requireAction: Boolean(run)
        });
        const normalizedCommand = commandContract.raw;
        if (run && typeof run !== "function") {
            throw new TypeError("Command run handlers must be functions.");
        }

        const entry: CliCommandEntry = {
            command: normalizedCommand,
            run: run ?? null,
            handleError: typeof handleError === "function" ? handleError : this._defaultErrorHandler
        };

        this._entries.add(entry);
        this._commandEntryLookup.set(normalizedCommand, entry);
        if (isDefault) {
            this._defaultCommandEntry = entry;
        }

        if (entry.run) {
            commandContract.action(this._createCommandAction(entry, normalizedCommand));
        }

        return entry;
    }

    private _createCommandAction(
        entry: CliCommandEntry,
        defaultCommand: CommanderCommandLike
    ): (...actionArgs: Array<unknown>) => Promise<void> {
        return async (...actionArgs: Array<unknown>) => {
            const contextCommand = resolveContextCommandFromActionArgs(actionArgs, defaultCommand);
            const previousActiveCommand = this._activeCommand;
            this._activeCommand = contextCommand;

            try {
                const result = await entry.run?.({ command: contextCommand });
                this._applyCommandResult(result);
            } catch (error) {
                this._handleCommandError(error, contextCommand);
            } finally {
                this._activeCommand = previousActiveCommand ?? null;
            }
        };
    }

    private _applyCommandResult(result: unknown): void {
        if (typeof result === "number") {
            process.exitCode = result;
        }
    }

    private _handleCommanderError(error: unknown): boolean {
        if (!isCommanderErrorLike(error)) {
            return false;
        }

        if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
            return true;
        }

        const commandFromError = error.command ?? this._activeCommand ?? this._program;
        const resolvedCommand = this._resolveCommandFromCommanderError(commandFromError);
        const usageError = this._createUsageErrorFromCommanderError(error, resolvedCommand);
        this._handleCommandError(usageError, resolvedCommand ?? this._program);
        return true;
    }

    private _handleCommandError(error: unknown, command: CommanderCommandLike): void {
        const entry = this._commandEntryLookup.get(command);
        const handler = entry?.handleError ?? this._defaultErrorHandler;
        handler(error, { command });
    }

    private _resolveCommandFromCommanderError(
        commandFromError?: CommanderCommandLike | null
    ): CommanderCommandLike | null {
        if (commandFromError === this._program && this._defaultCommandEntry?.command) {
            return this._defaultCommandEntry.command;
        }

        return commandFromError ?? this._program;
    }

    private _createUsageErrorFromCommanderError(
        error: Error & { message: string },
        resolvedCommand: CommanderCommandLike | null
    ): CliUsageError {
        const usage = resolveCommandUsage(resolvedCommand, {
            fallback: () => this._programContract.getUsage() ?? ""
        });
        const normalizedUsage = composeUsageHelpMessage({
            defaultHelpText: DEFAULT_HELP_AFTER_ERROR,
            usage
        });

        return new CliUsageError(error.message.trim(), {
            usage: normalizedUsage
        });
    }
}

export { CliCommandManager };

export function createCliCommandManager(options: CliCommandManagerOptions): {
    registry: CliCommandRegistry;
    runner: CliCommandRunner;
} {
    const manager = new CliCommandManager(options);
    const registry: CliCommandRegistry = Object.freeze({
        registerDefaultCommand: (registryOptions: CliCommandRegistrationOptions) =>
            manager.registerDefaultCommand(registryOptions),
        registerCommand: (registryOptions: CliCommandRegistrationOptions) => manager.registerCommand(registryOptions)
    });
    const runner: CliCommandRunner = Object.freeze({
        run: (argv: Array<string>) => manager.run(argv)
    });

    return Object.freeze({ registry, runner });
}
