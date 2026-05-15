import { Core } from "@gmloop/core";

import type {
    CommanderActionHandler,
    CommanderAddCommandOptions,
    CommanderCommandLike,
    CommanderExecutor,
    CommanderHookListener,
    CommanderParseOptions
} from "./commander-types.js";

const { assertFunctionProperties, describeValueWithArticle, hasFunction, isObjectOrFunction } = Core;

type CommanderParse = (argv?: Array<string>, options?: CommanderParseOptions) => Promise<unknown>;

interface CommanderCommandContractOptions {
    name?: string;
    requireAction?: boolean;
}

export interface CommanderProgramContract {
    raw: CommanderExecutor;
    parse: CommanderParse;
    addCommand: (command: CommanderCommandLike, options?: CommanderAddCommandOptions) => CommanderCommandLike;
    hook: (event: string, listener: CommanderHookListener) => CommanderExecutor;
    getUsage(): string | null;
}

export interface CommanderCommandContract {
    raw: CommanderCommandLike;
    action: (handler: CommanderActionHandler) => CommanderCommandLike;
    getUsage(): string | null;
}

function formatValueForUsage(output: unknown): string {
    if (output == null) {
        return "Unknown";
    }

    if (
        typeof output === "string" ||
        typeof output === "number" ||
        typeof output === "boolean" ||
        typeof output === "bigint"
    ) {
        return String(output);
    }

    if (typeof output === "symbol") {
        return output.toString();
    }

    if (typeof output === "function") {
        return output.name ? `[Function ${output.name}]` : "[Function]";
    }

    try {
        return JSON.stringify(output);
    } catch {
        return Object.prototype.toString.call(output);
    }
}

function normalizeUsageResult(output: unknown): string | null {
    if (output == null) {
        return null;
    }

    return formatValueForUsage(output);
}

function createUsageReader(target: unknown): (() => string | null | undefined) | null {
    if (!isObjectOrFunction(target)) {
        return null;
    }

    if (hasFunction(target, "helpInformation")) {
        const usageTarget = target as {
            helpInformation(): string;
        };
        return () => usageTarget.helpInformation();
    }

    if (hasFunction(target, "usage")) {
        const usageTarget = target as {
            usage(): string;
        };
        return () => usageTarget.usage();
    }

    if (hasFunction(target, "getUsage")) {
        const usageTarget = target as {
            getUsage(): string;
        };
        return () => usageTarget.getUsage();
    }

    return null;
}

function createProgramParseDelegate(program: CommanderExecutor): CommanderParse | null {
    if (typeof program.parseAsync === "function") {
        return (argv, options) => program.parseAsync?.(argv, options);
    }

    if (typeof program.parse === "function") {
        return (argv, options) => Promise.resolve(program.parse?.(argv, options));
    }

    return null;
}

function describeProgramForError(program: unknown): string {
    return describeValueWithArticle(program, {
        objectLabel: "a commander-compatible program"
    });
}

export function createCommanderProgramContract(program: CommanderExecutor): CommanderProgramContract {
    const normalizedProgram = assertFunctionProperties(program, ["addCommand", "hook"], {
        name: "Commander program"
    });

    const parse = createProgramParseDelegate(normalizedProgram);
    if (!parse) {
        throw new TypeError(
            `Commander program must provide parseAsync() or parse(); received ${describeProgramForError(program)}.`
        );
    }

    const usageReader = createUsageReader(normalizedProgram);

    return {
        raw: normalizedProgram,
        parse,
        addCommand(command, options) {
            const added = normalizedProgram.addCommand?.(command, options) ?? command;

            return added as CommanderCommandLike;
        },
        hook(event, listener) {
            const hooked = normalizedProgram.hook?.(event, listener) ?? normalizedProgram;

            return hooked as CommanderExecutor;
        },
        getUsage() {
            return normalizeUsageResult(usageReader?.());
        }
    };
}

export function createCommanderCommandContract(
    command: CommanderCommandLike,
    { name = "Commander command", requireAction = true }: CommanderCommandContractOptions = {}
): CommanderCommandContract {
    const methods = requireAction ? ["action"] : [];
    const normalizedCommand = assertFunctionProperties(command, methods, {
        name
    });

    const usageReader = createUsageReader(normalizedCommand);
    const hasAction = hasFunction(normalizedCommand, "action");

    return {
        raw: normalizedCommand,
        action(handler) {
            if (!hasAction) {
                throw new TypeError(`${name} does not expose action()`);
            }

            return (normalizedCommand.action?.(handler) ?? normalizedCommand) as CommanderCommandLike;
        },
        getUsage() {
            return normalizeUsageResult(usageReader?.());
        }
    };
}

export function tryCreateCommanderCommandContract(
    command: CommanderCommandLike,
    options?: CommanderCommandContractOptions
): CommanderCommandContract | null {
    try {
        return createCommanderCommandContract(command, options);
    } catch {
        return null;
    }
}

export function isCommanderCommandLike(value: unknown): value is CommanderCommandLike {
    if (!isObjectOrFunction(value)) {
        return false;
    }

    return createUsageReader(value) !== null;
}

export function getCommanderUsage(command: CommanderCommandLike): string | null {
    return normalizeUsageResult(createUsageReader(command)?.());
}
