import { copyFileSync, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";

import * as vscode from "vscode";
import {
    LanguageClient,
    type LanguageClientOptions,
    type ServerOptions,
    TransportKind
} from "vscode-languageclient/node.js";

import { resolveGmloopLanguageServerLaunch } from "./server-command.js";
import { resolveLocalGmlLoopRoots, syncLocalExtensionFilesPure } from "./sync.js";

const GMLOOP_CONFIGURATION_SECTION = "gmloop";
const GMLOOP_SERVER_PATH_SETTING = "serverPath";
const GMLOOP_LANGUAGE_ID = "gml";
const GMLOOP_CLIENT_ID = "gmloopGml";
const GMLOOP_CLIENT_NAME = "GMLoop GML Language Server";

let languageClient: LanguageClient | null = null;
let languageServerOutput: vscode.OutputChannel | null = null;
let projectFileWatcher: vscode.FileSystemWatcher | null = null;
let activeExtensionPath: string | null = null;

function syncLocalExtensionFiles(context: vscode.ExtensionContext): void {
    const configuredServerPath = vscode.workspace
        .getConfiguration(GMLOOP_CONFIGURATION_SECTION)
        .get<unknown>(GMLOOP_SERVER_PATH_SETTING);
    const monorepoRoots = resolveLocalGmlLoopRoots({
        configuredServerPath,
        existsSync,
        workspaceFolderPaths: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
    });

    syncLocalExtensionFilesPure({
        monorepoRoots,
        extensionPath: context.extensionPath,
        existsSync,
        readFileSync,
        writeFileSync,
        copyFileSync,
        onChanged() {
            void vscode.window.showInformationMessage(
                "GMLoop: Local build synchronized. Reloading VS Code to apply the new extension runtime."
            );
            void vscode.commands.executeCommand("workbench.action.reloadWindow");
        },
        logError(message, error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            getLanguageServerOutputChannel().appendLine(`${message} ${errorMessage}`);
        }
    });
}

function getLanguageServerOutputChannel(): vscode.OutputChannel {
    languageServerOutput ??= vscode.window.createOutputChannel(GMLOOP_CLIENT_NAME);
    return languageServerOutput;
}

function createServerOptions(): ServerOptions {
    const configuredServerPath = vscode.workspace
        .getConfiguration(GMLOOP_CONFIGURATION_SECTION)
        .get<unknown>(GMLOOP_SERVER_PATH_SETTING);
    const launch = resolveGmloopLanguageServerLaunch(configuredServerPath, {
        environment: process.env,
        extensionPath: activeExtensionPath,
        homeDirectory: homedir(),
        pathExists: existsSync,
        platform: process.platform,
        resolveRealPath: realpathSync,
        workspaceFolderPaths: vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []
    });

    if (launch.kind === "module") {
        return {
            run: { module: launch.modulePath, args: [...launch.args], transport: TransportKind.stdio },
            debug: { module: launch.modulePath, args: [...launch.args], transport: TransportKind.stdio }
        };
    }

    return {
        command: launch.command,
        args: [...launch.args]
    };
}

function createClientOptions(outputChannel: vscode.OutputChannel): LanguageClientOptions {
    return {
        documentSelector: [{ scheme: "file", language: GMLOOP_LANGUAGE_ID }],
        outputChannel,
        revealOutputChannelOn: 4,
        synchronize: {
            configurationSection: GMLOOP_CONFIGURATION_SECTION,
            fileEvents: projectFileWatcher ?? undefined
        }
    };
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (typeof error === "string") {
        return error;
    }

    return "Unknown error";
}

async function stopLanguageClient(): Promise<void> {
    if (languageClient === null) {
        return;
    }

    const currentClient = languageClient;
    languageClient = null;
    try {
        await currentClient.stop();
    } catch {
        // Ignore errors if the client was not running or could not be stopped
    }
}

async function startLanguageClient(): Promise<void> {
    await stopLanguageClient();

    const outputChannel = getLanguageServerOutputChannel();
    const client = new LanguageClient(
        GMLOOP_CLIENT_ID,
        GMLOOP_CLIENT_NAME,
        createServerOptions(),
        createClientOptions(outputChannel)
    );
    languageClient = client;
    await client.start();
}

async function restartLanguageClient(): Promise<void> {
    await startLanguageClient();
}

/**
 * Activate the GMLoop VSCode extension and start the GML language server.
 */
export function activate(context: vscode.ExtensionContext): void {
    activeExtensionPath = context.extensionPath;
    syncLocalExtensionFiles(context);
    projectFileWatcher ??= vscode.workspace.createFileSystemWatcher("**/*.{gml,yy,yyp}");
    context.subscriptions.push(
        projectFileWatcher,
        vscode.commands.registerCommand("gmloop.restartLanguageServer", restartLanguageClient),
        vscode.commands.registerCommand("gmloop.showLanguageServerOutput", () => {
            getLanguageServerOutputChannel().show();
        }),
        {
            dispose() {
                void stopLanguageClient();
            }
        }
    );

    void startLanguageClient().catch((error: unknown) => {
        void vscode.window.showErrorMessage(`Unable to start the GMLoop language server: ${getErrorMessage(error)}`);
    });
}

/**
 * Stop the GMLoop language server when VSCode deactivates the extension.
 */
export async function deactivate(): Promise<void> {
    await stopLanguageClient();
    projectFileWatcher?.dispose();
    projectFileWatcher = null;
}
