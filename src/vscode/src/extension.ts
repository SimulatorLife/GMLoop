import * as vscode from "vscode";
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node.js";

import { resolveGmloopLanguageServerExecutableOptions } from "./server-command.js";

const GMLOOP_CONFIGURATION_SECTION = "gmloop";
const GMLOOP_SERVER_PATH_SETTING = "serverPath";
const GMLOOP_LANGUAGE_ID = "gml";
const GMLOOP_CLIENT_ID = "gmloopGml";
const GMLOOP_CLIENT_NAME = "GMLoop GML Language Server";

let languageClient: LanguageClient | null = null;
let languageServerOutput: vscode.OutputChannel | null = null;

function getLanguageServerOutputChannel(): vscode.OutputChannel {
    languageServerOutput ??= vscode.window.createOutputChannel(GMLOOP_CLIENT_NAME);
    return languageServerOutput;
}

function createServerOptions(): ServerOptions {
    const configuredServerPath = vscode.workspace
        .getConfiguration(GMLOOP_CONFIGURATION_SECTION)
        .get<unknown>(GMLOOP_SERVER_PATH_SETTING);
    const serverCommand = resolveGmloopLanguageServerExecutableOptions(configuredServerPath);

    return {
        command: serverCommand.command,
        args: [...serverCommand.args]
    };
}

function createClientOptions(outputChannel: vscode.OutputChannel): LanguageClientOptions {
    return {
        documentSelector: [{ scheme: "file", language: GMLOOP_LANGUAGE_ID }],
        outputChannel,
        revealOutputChannelOn: 4,
        synchronize: {
            configurationSection: GMLOOP_CONFIGURATION_SECTION
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
    await currentClient.stop();
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
    context.subscriptions.push(
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
}
