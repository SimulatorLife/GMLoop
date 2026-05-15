import type { CliCommandRegistry } from "./cli-core/command-manager.js";
import { handleCliError } from "./cli-core/errors.js";
import { createCollectStatsCommand, runCollectStats } from "./commands/collect-stats.js";
import { createFixCommand, runFixCommand } from "./commands/fix.js";
import { createFormatCommand, runFormatCommand } from "./commands/format.js";
import { createFeatherMetadataCommand, runGenerateFeatherMetadata } from "./commands/generate-feather-metadata.js";
import { createGenerateIdentifiersCommand, runGenerateGmlIdentifiers } from "./commands/generate-gml-identifiers.js";
import { createGenerateQualityReportCommand, runGenerateQualityReport } from "./commands/generate-quality-report.js";
import { createGameMakerCliCommand } from "./commands/gm-cli.js";
import { createGraphCommand } from "./commands/graph.js";
import { createLintCommand, runLintCommand } from "./commands/lint.js";
import { createLiveReloadCommand } from "./commands/live-reload.js";
import { createMcpCommand } from "./commands/mcp.js";
import { createObjectCommand } from "./commands/object.js";
import { createParseCommand, runParseCommand } from "./commands/parse.js";
import { createProfileCommand } from "./commands/profile.js";
import { createProjectCommand } from "./commands/project.js";
import { createRefactorCommand, runRefactorCommand } from "./commands/refactor.js";
import { createReplayCommand } from "./commands/replay.js";
import { createResourceCommand } from "./commands/resource.js";
import { createRoomCommand } from "./commands/room.js";
import { createRunnerCommand } from "./commands/runner.js";
import { createRuntimeCommand } from "./commands/runtime.js";
import { createSymbolCommand } from "./commands/symbol.js";
import { createTestCommand } from "./commands/test.js";
import { createTranspileCommand, runTranspileCommand } from "./commands/transpile.js";
import { createUiCommand } from "./commands/ui.js";
import { createValidateCommand } from "./commands/validate.js";

type CliCommandRegistrationEnvironment = Readonly<{
    defaultCommandName: string;
    env: NodeJS.ProcessEnv;
    registry: CliCommandRegistry;
}>;

type CliCommandRegistryContext = Readonly<{
    registry: CliCommandRegistry;
}>;

type CliCommandEnvironmentRegistryContext = CliCommandRegistryContext &
    Readonly<{
        env: NodeJS.ProcessEnv;
    }>;

type CliDefaultCommandRegistrationContext = CliCommandRegistryContext &
    Readonly<{
        defaultCommandName: string;
    }>;

/**
 * Register the complete GMLoop command surface with the CLI command registry.
 *
 * Keeping registration in one focused module lets `cli.ts` own process setup,
 * test capture, and autorun behavior while command wiring remains a clear CLI
 * catalog concern.
 */
export function registerCliCommands({ defaultCommandName, env, registry }: CliCommandRegistrationEnvironment): void {
    registerDefaultFormattingCommand({ defaultCommandName, registry });
    registerAnalysisCommands({ registry });
    registerGenerationCommands({ env, registry });
    registerProjectWorkflowCommands({ registry });
    registerUtilityCommands({ registry });
}

function registerDefaultFormattingCommand({
    defaultCommandName,
    registry
}: CliDefaultCommandRegistrationContext): void {
    registry.registerDefaultCommand({
        command: createFormatCommand({ name: defaultCommandName }),
        run: ({ command }) => runFormatCommand(command),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to format project.",
                exitCode: 1
            })
    });
}

function registerAnalysisCommands({ registry }: CliCommandRegistryContext): void {
    registry.registerCommand({
        command: createGraphCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Graph command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createLintCommand(),
        run: ({ command }) => runLintCommand(command),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Lint command failed.",
                exitCode: 2
            })
    });

    registry.registerCommand({
        command: createParseCommand(),
        run: ({ command }) => runParseCommand(command),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Parse command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createFixCommand(),
        run: ({ command }) => runFixCommand(command),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to run project fix workflow.",
                exitCode: 1
            })
    });
}

function registerGenerationCommands({ env, registry }: CliCommandEnvironmentRegistryContext): void {
    registry.registerCommand({
        command: createGenerateIdentifiersCommand({ env }),
        run: ({ command }) => runGenerateGmlIdentifiers({ command }),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to generate GML identifiers.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createGenerateQualityReportCommand(),
        run: ({ command }) => runGenerateQualityReport({ command }),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to generate quality report.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createCollectStatsCommand(),
        run: ({ command }) => runCollectStats({ command }),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to collect project stats.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createFeatherMetadataCommand(),
        run: ({ command }) => runGenerateFeatherMetadata({ command }),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to generate Feather metadata.",
                exitCode: 1
            })
    });
}

function registerProjectWorkflowCommands({ registry }: CliCommandRegistryContext): void {
    registry.registerCommand({
        command: createGameMakerCliCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "GameMaker CLI command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createLiveReloadCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Live-reload command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createRefactorCommand(),
        run: ({ command }) => runRefactorCommand(command),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to perform refactor operation.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createResourceCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Failed to perform resource operation.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createRoomCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Room command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createObjectCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Object command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createProjectCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Project command failed.",
                exitCode: 1
            })
    });
}

function registerUtilityCommands({ registry }: CliCommandRegistryContext): void {
    registry.registerCommand({
        command: createMcpCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "MCP command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createUiCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "UI command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createProfileCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Profile command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createTestCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Test command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createReplayCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Replay command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createSymbolCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Symbol command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createRunnerCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Runner command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createRuntimeCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Runtime command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createValidateCommand(),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Validate command failed.",
                exitCode: 1
            })
    });

    registry.registerCommand({
        command: createTranspileCommand(),
        run: ({ command }) => runTranspileCommand(command),
        onError: (error) =>
            handleCliError(error, {
                prefix: "Transpile command failed.",
                exitCode: 1
            })
    });
}
