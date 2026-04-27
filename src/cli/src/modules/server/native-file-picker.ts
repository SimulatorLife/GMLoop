import { execFile } from "node:child_process";

type NativeFilePickerResult = Readonly<{
    cancelled: boolean;
    selectedPaths: ReadonlyArray<string>;
}>;

type NativeOpenPanelMode = "directories" | "game-maker-files";

/**
 * Open the macOS native file picker and select one directory target.
 */
export async function pickDirectoryWithNativeDialog(): Promise<NativeFilePickerResult> {
    if (process.platform !== "darwin") {
        throw new Error("Native folder selection is currently supported on macOS only.");
    }

    return await runNativeOpenPanel("directories");
}

/**
 * Open the macOS native file picker and select one or more `.gml`/`.yyp` file targets.
 */
export async function pickGameMakerFilesWithNativeDialog(): Promise<NativeFilePickerResult> {
    if (process.platform !== "darwin") {
        throw new Error("Native file selection is currently supported on macOS only.");
    }

    return await runNativeOpenPanel("game-maker-files");
}

async function runNativeOpenPanel(mode: NativeOpenPanelMode): Promise<NativeFilePickerResult> {
    const script = buildOpenPanelScript(mode);
    return await new Promise((resolve, reject) => {
        execFile("osascript", ["-l", "JavaScript", "-e", script], (error, stdout, stderr) => {
            if (isAppleScriptCancel(error, stderr)) {
                resolve(
                    Object.freeze({
                        cancelled: true,
                        selectedPaths: []
                    })
                );
                return;
            }

            if (error) {
                reject(error instanceof Error ? error : new Error("Failed to execute native file picker."));
                return;
            }

            const selectedPaths = stdout
                .split(/\r?\n/u)
                .map((value) => value.trim())
                .filter((value) => value.length > 0);

            resolve(
                Object.freeze({
                    cancelled: false,
                    selectedPaths
                })
            );
        });
    });
}

function buildOpenPanelScript(mode: NativeOpenPanelMode): string {
    if (mode === "directories") {
        return `
ObjC.import('AppKit');

const panel = $.NSOpenPanel.openPanel;
panel.setCanChooseFiles(false);
panel.setCanChooseDirectories(true);
panel.setAllowsMultipleSelection(false);
panel.setCanCreateDirectories(false);
panel.setPrompt('Load Folder');
panel.setMessage('Select a GameMaker project folder or subfolder');

const response = panel.runModal();
if (response !== $.NSModalResponseOK) {
    throw new Error('-128');
}

const selectedUrl = panel.URL;
console.log(ObjC.unwrap(selectedUrl.path));
`;
    }

    return `
ObjC.import('AppKit');

const panel = $.NSOpenPanel.openPanel;
panel.setCanChooseFiles(true);
panel.setCanChooseDirectories(false);
panel.setAllowsMultipleSelection(true);
panel.setAllowedFileTypes(['gml', 'yyp']);
panel.setPrompt('Load Files');
panel.setMessage('Select .gml or .yyp files');

const response = panel.runModal();
if (response !== $.NSModalResponseOK) {
    throw new Error('-128');
}

const selectedUrls = ObjC.deepUnwrap(panel.URLs);
for (const selectedUrl of selectedUrls) {
    console.log(selectedUrl.path);
}
`;
}

function isAppleScriptCancel(error: Error | null, stderr: string): boolean {
    if (!error) {
        return false;
    }

    const combinedText = `${error.message}\n${stderr}`;
    return combinedText.includes("-128");
}
