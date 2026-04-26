import { execFile } from "node:child_process";

type NativeFilePickerResult = Readonly<{
    cancelled: boolean;
    selectedPaths: ReadonlyArray<string>;
}>;

/**
 * Open the macOS native file picker and select one directory target.
 */
export async function pickDirectoryWithNativeDialog(): Promise<NativeFilePickerResult> {
    if (process.platform !== "darwin") {
        throw new Error("Native folder selection is currently supported on macOS only.");
    }

    const script = [
        'set pickedFolder to choose folder with prompt "Select a GameMaker project folder or subfolder"',
        "return POSIX path of pickedFolder"
    ];
    return await runAppleScriptSelection(script);
}

/**
 * Open the macOS native file picker and select one or more `.gml`/`.yyp` file targets.
 */
export async function pickGameMakerFilesWithNativeDialog(): Promise<NativeFilePickerResult> {
    if (process.platform !== "darwin") {
        throw new Error("Native file selection is currently supported on macOS only.");
    }

    const script = [
        'set pickedFiles to choose file with prompt "Select .gml or .yyp files" of type {"gml", "yyp"} with multiple selections allowed',
        'set outputText to ""',
        "repeat with pickedFile in pickedFiles",
        "    set outputText to outputText & (POSIX path of pickedFile) & linefeed",
        "end repeat",
        "return outputText"
    ];
    return await runAppleScriptSelection(script);
}

function runAppleScriptSelection(scriptLines: ReadonlyArray<string>): Promise<NativeFilePickerResult> {
    const flattenedScript = scriptLines.join("\n");
    return new Promise((resolve, reject) => {
        execFile("osascript", ["-e", flattenedScript], (error, stdout, stderr) => {
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

function isAppleScriptCancel(error: Error | null, stderr: string): boolean {
    if (!error) {
        return false;
    }

    const combinedText = `${error.message}\n${stderr}`;
    return combinedText.includes("-128");
}
