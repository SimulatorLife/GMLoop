import { execFile } from "node:child_process";

import { Core } from "@gmloop/core";

import type { OsaScriptExecutionResult } from "./types.js";

function isMacOsDialogCancellationError(error: unknown, stderr: string): boolean {
    if (!Core.isErrorLike(error)) {
        return false;
    }

    return error.message.includes("User canceled") || stderr.includes("User canceled");
}

function readOsaScriptErrorStderr(error: unknown): string {
    if (typeof error !== "object" || error === null || !("stderr" in error)) {
        return "";
    }

    const stderrCandidate = Reflect.get(error, "stderr");
    return typeof stderrCandidate === "string" ? stderrCandidate : "";
}

function runOsaScript(lines: ReadonlyArray<string>): Promise<OsaScriptExecutionResult> {
    return new Promise<OsaScriptExecutionResult>((resolve, reject) => {
        const args = lines.flatMap((line) => ["-e", line] as const);
        execFile("osascript", args, { encoding: "utf8" }, (error, stdout, stderr) => {
            if (error) {
                reject(Core.isErrorLike(error) ? error : new Error("osascript execution failed."));
                return;
            }
            resolve(
                Object.freeze({
                    stderr,
                    stdout
                })
            );
        });
    });
}

/**
 * Prompt the user to pick a GameMaker `.yyp` project file using the native macOS file dialog.
 * Returns the chosen path, or `null` if the user cancelled the dialog, the
 * platform is not macOS, or `osascript` is not available.
 */
async function pickProjectPathUsingNativeDialog(): Promise<string | null> {
    if (process.platform !== "darwin") {
        return null;
    }

    const scriptLines = [
        'return POSIX path of (choose file with prompt "Choose a GameMaker .yyp project file:" of type {"yyp"})'
    ];

    try {
        const result = await runOsaScript(scriptLines);
        return result.stdout.trim();
    } catch (error: unknown) {
        if (Core.isErrorLike(error)) {
            const stderr = readOsaScriptErrorStderr(error);
            if (isMacOsDialogCancellationError(error, stderr)) {
                return null;
            }
        }
        throw error;
    }
}

export { isMacOsDialogCancellationError, pickProjectPathUsingNativeDialog, readOsaScriptErrorStderr, runOsaScript };
