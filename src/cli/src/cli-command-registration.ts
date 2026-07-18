import type { CliCatalogEntry } from "./cli-core/command-catalog.js";
import type { CliCommandRegistry } from "./cli-core/command-manager.js";
import { createCliCommandErrorHandler } from "./cli-core/errors.js";
import type { McpToolCatalogEntry } from "./cli-core/mcp-tool-catalog.js";
import { createAgentPackCommand } from "./commands/agent-pack.js";
import { createCollectStatsCommand, runCollectStats } from "./commands/collect-stats.js";
import { createFixCommand, runFixCommand } from "./commands/fix.js";
import { createFormatCommand, runFormatCommand } from "./commands/format.js";
import { createGameMakerCliCommand } from "./commands/game-maker-cli.js";
import { createFeatherMetadataCommand, runGenerateFeatherMetadata } from "./commands/generate-feather-metadata.js";
import { createGenerateIdentifiersCommand, runGenerateGmlIdentifiers } from "./commands/generate-gml-identifiers.js";
import { createGenerateQualityReportCommand, runGenerateQualityReport } from "./commands/generate-quality-report.js";
import { createGraphCommand } from "./commands/graph.js";
import { createLintCommand, runLintCommand } from "./commands/lint.js";
import { createLiveReloadCommand } from "./commands/live-reload.js";
import { createLspCommand } from "./commands/lsp.js";
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
import { createScriptCommand } from "./commands/script.js";
import { createSymbolCommand } from "./commands/symbol.js";
import { createTestCommand } from "./commands/test.js";
import { createTranspileCommand, runTranspileCommand } from "./commands/transpile.js";
import { createUiCommand } from "./commands/ui.js";
import { createWatchCommand } from "./commands/watch.js";

type CliCommandRegistrationEnvironment = Readonly<{
    defaultCommandName: string;
    env: NodeJS.ProcessEnv;
    getCliCommandCatalog: () => ReadonlyArray<CliCatalogEntry>;
    getMcpToolCatalogEntries: () => ReadonlyArray<McpToolCatalogEntry>;
    registry: CliCommandRegistry;
}>;

type CliCommandRegistryContext = Readonly<{
    registry: CliCommandRegistry;
}>;

type CliCommandEnvironmentRegistryContext = CliCommandRegistryContext &
    Readonly<{
        env: NodeJS.ProcessEnv;
    }>;

type CliCommandCatalogRegistryContext = CliCommandEnvironmentRegistryContext &
    Readonly<{
        getCliCommandCatalog: () => ReadonlyArray<CliCatalogEntry>;
        getMcpToolCatalogEntries: () => ReadonlyArray<McpToolCatalogEntry>;
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
export function registerCliCommands({
    defaultCommandName,
    env,
    getCliCommandCatalog,
    getMcpToolCatalogEntries,
    registry
}: CliCommandRegistrationEnvironment): void {
    registerDefaultFormattingCommand({ defaultCommandName, registry });
    registerAnalysisCommands({ registry });
    registerGenerationCommands({ env, registry });
    registerProjectWorkflowCommands({ registry });
    registerUtilityCommands({
        env,
        getCliCommandCatalog,
        getMcpToolCatalogEntries,
        registry
    });
}

function registerDefaultFormattingCommand({
    defaultCommandName,
    registry
}: CliDefaultCommandRegistrationContext): void {
    registry.registerDefaultCommand({
        command: createFormatCommand({ name: defaultCommandName }),
        operationKind: "format",
        run: ({ command }) => runFormatCommand(command),
        onError: createCliCommandErrorHandler({ prefix: "Failed to format project." })
    });
}

function registerAnalysisCommands({ registry }: CliCommandRegistryContext): void {
    registry.registerCommand({
        command: createGraphCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Graph command failed." })
    });

    registry.registerCommand({
        command: createLintCommand(),
        operationKind: "lint",
        run: ({ command }) => runLintCommand(command),
        onError: createCliCommandErrorHandler({ prefix: "Lint command failed.", exitCode: 2 })
    });

    registry.registerCommand({
        command: createParseCommand(),
        run: ({ command }) => runParseCommand(command),
        onError: createCliCommandErrorHandler({ prefix: "Parse command failed." })
    });

    registry.registerCommand({
        command: createFixCommand(),
        operationKind: "fix",
        run: ({ command }) => runFixCommand(command),
        onError: createCliCommandErrorHandler({ prefix: "Failed to run project fix workflow." })
    });
}

function registerGenerationCommands({ env, registry }: CliCommandEnvironmentRegistryContext): void {
    registry.registerCommand({
        command: createGenerateIdentifiersCommand({ env }),
        run: ({ command }) => runGenerateGmlIdentifiers({ command }),
        onError: createCliCommandErrorHandler({ prefix: "Failed to generate GML identifiers." })
    });

    registry.registerCommand({
        command: createGenerateQualityReportCommand(),
        run: ({ command }) => runGenerateQualityReport({ command }),
        onError: createCliCommandErrorHandler({ prefix: "Failed to generate quality report." })
    });

    registry.registerCommand({
        command: createCollectStatsCommand(),
        run: ({ command }) => runCollectStats({ command }),
        onError: createCliCommandErrorHandler({ prefix: "Failed to collect project stats." })
    });

    registry.registerCommand({
        command: createFeatherMetadataCommand(),
        run: ({ command }) => runGenerateFeatherMetadata({ command }),
        onError: createCliCommandErrorHandler({ prefix: "Failed to generate Feather metadata." })
    });
}

function registerProjectWorkflowCommands({ registry }: CliCommandRegistryContext): void {
    registry.registerCommand({
        command: createLiveReloadCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Live-reload command failed." })
    });

    registry.registerCommand({
        command: createWatchCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Watch command failed." })
    });

    registry.registerCommand({
        command: createRefactorCommand(),
        operationKind: "refactor",
        run: ({ command }) => runRefactorCommand(command),
        onError: createCliCommandErrorHandler({ prefix: "Failed to perform refactor operation." })
    });

    registry.registerCommand({
        command: createResourceCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Failed to perform resource operation." })
    });

    registry.registerCommand({
        command: createRoomCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Room command failed." })
    });

    registry.registerCommand({
        command: createScriptCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Script command failed." })
    });

    registry.registerCommand({
        command: createObjectCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Object command failed." })
    });

    registry.registerCommand({
        command: createProjectCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Project command failed." })
    });

    registry.registerCommand({
        command: createAgentPackCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Agent-pack command failed." })
    });
}

function registerUtilityCommands({
    env,
    getCliCommandCatalog,
    getMcpToolCatalogEntries,
    registry
}: CliCommandCatalogRegistryContext): void {
    registry.registerCommand({
        command: createGameMakerCliCommand({ env, getCliCommandCatalog, getMcpToolCatalogEntries }),
        onError: createCliCommandErrorHandler({ prefix: "GameMaker CLI command failed." })
    });

    registry.registerCommand({
        command: createMcpCommand(),
        onError: createCliCommandErrorHandler({ prefix: "MCP command failed." })
    });

    registry.registerCommand({
        command: createLspCommand(),
        onError: createCliCommandErrorHandler({ prefix: "LSP command failed." })
    });

    registry.registerCommand({
        command: createUiCommand(),
        onError: createCliCommandErrorHandler({ prefix: "UI command failed." })
    });

    registry.registerCommand({
        command: createProfileCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Profile command failed." })
    });

    registry.registerCommand({
        command: createTestCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Test command failed." })
    });

    registry.registerCommand({
        command: createReplayCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Replay command failed." })
    });

    registry.registerCommand({
        command: createSymbolCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Symbol command failed." })
    });

    registry.registerCommand({
        command: createRunnerCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Runner command failed." })
    });

    registry.registerCommand({
        command: createRuntimeCommand(),
        onError: createCliCommandErrorHandler({ prefix: "Runtime command failed." })
    });

    registry.registerCommand({
        command: createTranspileCommand(),
        run: ({ command }) => runTranspileCommand(command),
        onError: createCliCommandErrorHandler({ prefix: "Transpile command failed." })
    });
}
