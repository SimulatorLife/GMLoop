export type KnownCommanderParseSource = "user" | "node" | "electron";

export interface CommanderParseOptions {
    from?: KnownCommanderParseSource;
}

export interface CommanderConfigureOutputOptions {
    writeOut?: (...args: Array<unknown>) => unknown;
    writeErr?: (...args: Array<unknown>) => unknown;
    outputError?: (...args: Array<unknown>) => unknown;
}

export interface CommanderOptionLike {
    long?: string;
    short?: string;
    flags?: string;
    description?: string;
}

export interface CommanderUsageProvider {
    helpInformation?: () => string;
    usage?: () => string;
    getUsage?: () => string;
}

export type CommanderHookListener = (...args: Array<unknown>) => unknown;

export interface CommanderLifecycle {
    hook?: (event: string, listener: CommanderHookListener) => unknown;
    on?: (event: string, listener: CommanderHookListener) => unknown;
}

export interface CommanderAddCommandOptions {
    isDefault?: boolean;
}

export type CommanderActionHandler = (...args: Array<unknown>) => unknown;

export interface CommanderCommandHost extends CommanderUsageProvider, CommanderLifecycle {
    addCommand?: (command: CommanderCommandHost, options?: CommanderAddCommandOptions) => unknown;
    action?: (handler: CommanderActionHandler) => unknown;
    outputHelp?: (contextOptions?: { error?: boolean }) => unknown;
}

/**
 * Command execution operations.
 *
 * Provides the core capability to parse arguments and execute command logic
 * without coupling to configuration, help display, or option management.
 * Consumers that only need to run commands (e.g., test harnesses) should
 * depend on this interface rather than the full CommanderCommandLike.
 */
export interface CommanderExecutor extends CommanderCommandHost {
    parse?: (argv?: Array<string>, options?: CommanderParseOptions) => unknown;
    parseAsync?: (argv?: Array<string>, options?: CommanderParseOptions) => Promise<unknown>;
    args?: Array<string>;
    processedArgs?: Array<string>;
    opts?: () => Record<string, unknown>;
}

/**
 * Command behavior configuration.
 *
 * Provides the ability to configure command behavior such as error handling,
 * help display, and argument validation without coupling to execution or
 * option value management. Used primarily during command initialization.
 */
export interface CommanderConfigurator {
    exitOverride?: (...args: Array<unknown>) => unknown;
    allowExcessArguments?: (allow?: boolean) => unknown;
    helpOption?: (flags?: string, description?: string) => unknown;
    showHelpAfterError?: (message?: string | boolean) => unknown;
    configureOutput?: (options: CommanderConfigureOutputOptions) => unknown;
}

/**
 * Option value management.
 *
 * Provides the ability to set option values programmatically with source
 * tracking without coupling to execution or configuration operations.
 * Used primarily by environment variable override utilities.
 */
export interface CommanderOptionSetter {
    setOptionValueWithSource?: (optionName: string, value: unknown, source?: string) => unknown;
}

/**
 * Complete command interface.
 *
 * Combines all role-focused interfaces for consumers that need full
 * command capabilities. Consumers should prefer depending on the minimal
 * interface they need (CommanderExecutor, CommanderConfigurator,
 * CommanderOptionSetter) rather than this composite interface when possible.
 */
export interface CommanderCommandLike extends CommanderExecutor, CommanderConfigurator, CommanderOptionSetter {
    name?: () => string;
    options?: ReadonlyArray<CommanderOptionLike>;
}
