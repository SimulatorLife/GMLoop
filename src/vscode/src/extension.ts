import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

import * as vscode from "vscode";
import { LanguageClient, type LanguageClientOptions, type ServerOptions } from "vscode-languageclient/node.js";

import { resolveGmloopLanguageServerExecutableOptions } from "./server-command.js";
import { syncLocalExtensionFilesPure } from "./sync.js";

const GMLOOP_CONFIGURATION_SECTION = "gmloop";
const GMLOOP_SERVER_PATH_SETTING = "serverPath";
const GMLOOP_LANGUAGE_ID = "gml";
const GMLOOP_CLIENT_ID = "gmloopGml";
const GMLOOP_CLIENT_NAME = "GMLoop GML Language Server";

let languageClient: LanguageClient | null = null;
let languageServerOutput: vscode.OutputChannel | null = null;
let projectFileWatcher: vscode.FileSystemWatcher | null = null;

function syncLocalExtensionFiles(context: vscode.ExtensionContext): void {
    syncLocalExtensionFilesPure({
        workspaceFolders: vscode.workspace.workspaceFolders,
        extensionPath: context.extensionPath,
        existsSync,
        readFileSync,
        copyFileSync,
        onChanged() {
            void vscode.window
                .showInformationMessage(
                    "GMLoop: Local extension grammars updated from monorepo. Please reload VS Code to apply changes.",
                    "Reload Window"
                )
                .then((selection) => {
                    if (selection === "Reload Window") {
                        void vscode.commands.executeCommand("workbench.action.reloadWindow");
                    }
                });
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
    const serverCommand = resolveGmloopLanguageServerExecutableOptions(configuredServerPath);

    let command = serverCommand.command;
    let args: string[] = [...serverCommand.args];

    if (command === "gmloop" && vscode.workspace.workspaceFolders) {
        for (const folder of vscode.workspace.workspaceFolders) {
            const monorepoCliPath = path.join(folder.uri.fsPath, "src/cli/dist/index.js");
            if (existsSync(monorepoCliPath)) {
                command = "node";
                args = [monorepoCliPath, "lsp"];
                break;
            }
            const localBinPath = path.join(folder.uri.fsPath, "node_modules", ".bin", "gmloop");
            if (existsSync(localBinPath)) {
                command = localBinPath;
                break;
            }
        }
    }

    return {
        command,
        args
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
    syncLocalExtensionFiles(context);
    projectFileWatcher ??= vscode.workspace.createFileSystemWatcher("**/*.{gml,yy,yyp}");
    context.subscriptions.push(
        projectFileWatcher,
        vscode.commands.registerCommand("gmloop.restartLanguageServer", restartLanguageClient),
        vscode.commands.registerCommand("gmloop.showLanguageServerOutput", () => {
            getLanguageServerOutputChannel().show();
        }),
        vscode.commands.registerCommand("gmloop.applyLintFixes", async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor) {
                return;
            }
            const document = editor.document;
            if (document.languageId !== GMLOOP_LANGUAGE_ID) {
                return;
            }
            if (languageClient === null) {
                void vscode.window.showErrorMessage("GMLoop: Language server is not running.");
                return;
            }
            try {
                const workspaceEdit = await languageClient.sendRequest<any>("gmloop/applyLintFixes", {
                    uri: document.uri.toString()
                });
                if (workspaceEdit) {
                    const vscodeWorkspaceEdit =
                        await languageClient.protocol2CodeConverter.asWorkspaceEdit(workspaceEdit);
                    if (vscodeWorkspaceEdit) {
                        await vscode.workspace.applyEdit(vscodeWorkspaceEdit);
                    }
                } else {
                    void vscode.window.showInformationMessage("GMLoop: No lint fixes to apply.");
                }
            } catch (error) {
                void vscode.window.showErrorMessage(`GMLoop: Failed to apply lint fixes: ${getErrorMessage(error)}`);
            }
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
