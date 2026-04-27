import { execFile } from "node:child_process";

type NativeFilePickerResult = Readonly<{
    cancelled: boolean;
    selectedPaths: ReadonlyArray<string>;
}>;

/**
 * Open the macOS native file picker and select one or more GameMaker project targets.
 */
export async function pickProjectTargetsWithNativeDialog(): Promise<NativeFilePickerResult> {
    if (process.platform !== "darwin") {
        throw new Error("Native project selection is currently supported on macOS only.");
    }

    return await runNativeOpenPanel();
}

async function runNativeOpenPanel(): Promise<NativeFilePickerResult> {
    const script = buildOpenPanelScript();
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

function buildOpenPanelScript(): string {
    return `
ObjC.import('AppKit');

const panel = $.NSOpenPanel.openPanel;
panel.setCanChooseFiles(true);
panel.setCanChooseDirectories(true);
panel.setAllowsMultipleSelection(true);
panel.setCanCreateDirectories(false);
panel.setPrompt('Open...');
panel.setMessage('Select a GameMaker project folder, .yyp file, or .gml files');

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
