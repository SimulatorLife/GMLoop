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

const OSASCRIPT_COMMAND = "/usr/bin/osascript";

async function runNativeOpenPanel(): Promise<NativeFilePickerResult> {
    const script = buildOpenPanelScript();
    return await new Promise((resolve, reject) => {
        execFile(OSASCRIPT_COMMAND, ["-e", script], { windowsHide: true }, (error, stdout, stderr) => {
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
set promptText to "Select a GameMaker project folder, .yyp file, or .gml files"

tell application "Finder"
    activate
end tell

set chosenItems to choose file or folder with prompt promptText with multiple selections allowed

set selectedPaths to {}
if class of chosenItems is list then
    repeat with chosenItem in chosenItems
        set end of selectedPaths to POSIX path of chosenItem
    end repeat
else
    set end of selectedPaths to POSIX path of chosenItems
end if

set AppleScript's text item delimiters to "\n"
set chosenResult to selectedPaths as string
return chosenResult
`;
}

function isAppleScriptCancel(error: Error | null, stderr: string): boolean {
    if (!error) {
        return false;
    }

    const combinedText = `${error.message}\n${stderr}`;
    return combinedText.includes("-128");
}
