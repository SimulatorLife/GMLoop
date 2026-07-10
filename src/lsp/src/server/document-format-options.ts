import path from "node:path";

import { Core } from "@gmloop/core";
import { Format } from "@gmloop/format";
import { Semantic } from "@gmloop/semantic";

export type DocumentFormattingPreferences = Readonly<{
    insertSpaces: boolean;
    tabSize: number;
}>;

/**
 * Resolve formatter options for an LSP document-formatting request.
 *
 * Editor indentation preferences provide fallbacks, while formatter-owned
 * values explicitly configured in the project-root `gmloop.json` take
 * precedence so formatting through the editor matches the GMLoop CLI.
 *
 * @param documentPath Absolute path of the GML document being formatted.
 * @param preferences Indentation preferences sent by the LSP client.
 * @returns Effective Prettier options for the document.
 */
export async function resolveDocumentFormatOptions(
    documentPath: string,
    preferences: DocumentFormattingPreferences
): Promise<Record<string, unknown>> {
    const editorOptions: Record<string, unknown> = {
        tabWidth: preferences.tabSize,
        useTabs: !preferences.insertSpaces
    };
    const projectRoot = await Semantic.findProjectRoot({ filepath: documentPath });
    if (projectRoot === null) {
        return editorOptions;
    }

    try {
        const projectConfig = await Core.loadGmloopProjectConfig(path.join(projectRoot, "gmloop.json"));
        return {
            ...editorOptions,
            ...Format.extractProjectFormatOptions(projectConfig)
        };
    } catch (error) {
        if (Core.isErrorWithCode(error, "ENOENT")) {
            return editorOptions;
        }
        throw error;
    }
}
