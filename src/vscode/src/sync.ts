import path from "node:path";

export interface SyncLocalExtensionFilesParameters {
    readonly workspaceFolders: readonly { readonly uri: { readonly fsPath: string } }[] | undefined;
    readonly extensionPath: string;
    readonly existsSync: (path: string) => boolean;
    readonly readFileSync: (path: string, encoding: "utf8") => string;
    readonly copyFileSync: (src: string, dest: string) => void;
    readonly onChanged: () => void;
    readonly logError?: (message: string, error: unknown) => void;
}

export function syncLocalExtensionFilesPure(parameters: SyncLocalExtensionFilesParameters): void {
    if (!parameters.workspaceFolders) {
        return;
    }

    for (const folder of parameters.workspaceFolders) {
        const monorepoRoot = folder.uri.fsPath;
        const targetGmlGrammarPath = path.join(monorepoRoot, "src/vscode/syntaxes/gml.tmLanguage.json");
        if (parameters.existsSync(targetGmlGrammarPath)) {
            const filesToSync = [
                {
                    src: path.join(monorepoRoot, "src/vscode/syntaxes/gml.tmLanguage.json"),
                    dest: path.join(parameters.extensionPath, "syntaxes/gml.tmLanguage.json")
                },
                {
                    src: path.join(monorepoRoot, "src/vscode/syntaxes/markdown-gml.tmLanguage.json"),
                    dest: path.join(parameters.extensionPath, "syntaxes/markdown-gml.tmLanguage.json")
                },
                {
                    src: path.join(monorepoRoot, "src/vscode/language-configuration.json"),
                    dest: path.join(parameters.extensionPath, "language-configuration.json")
                },
                {
                    src: path.join(monorepoRoot, "src/vscode/package.json"),
                    dest: path.join(parameters.extensionPath, "package.json")
                }
            ];

            let changed = false;
            for (const file of filesToSync) {
                if (!parameters.existsSync(file.src)) {
                    continue;
                }
                let needsCopy = false;
                if (parameters.existsSync(file.dest)) {
                    const srcContent = parameters.readFileSync(file.src, "utf8");
                    const destContent = parameters.readFileSync(file.dest, "utf8");
                    if (srcContent !== destContent) {
                        needsCopy = true;
                    }
                } else {
                    needsCopy = true;
                }
                if (needsCopy) {
                    try {
                        parameters.copyFileSync(file.src, file.dest);
                        changed = true;
                    } catch (error) {
                        parameters.logError?.(`Failed to sync ${file.src} to ${file.dest}:`, error);
                    }
                }
            }

            if (changed) {
                parameters.onChanged();
            }
            break;
        }
    }
}
