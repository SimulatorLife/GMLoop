import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

const GAME_MAKER_PROJECT_FILE_EXTENSION = ".yyp";
const INVALID_GAME_MAKER_PROJECT_FILE_ERROR_NAME = "InvalidGameMakerProjectFileError";

/**
 * Error raised when the UI open-project workflow receives a path that is not a
 * valid GameMaker project manifest.
 */
export class InvalidGameMakerProjectFileError extends Error {
    constructor(message: string) {
        super(message);
        this.name = INVALID_GAME_MAKER_PROJECT_FILE_ERROR_NAME;
    }
}

/**
 * Type guard for {@link InvalidGameMakerProjectFileError}.
 */
export function isInvalidGameMakerProjectFileError(value: unknown): value is InvalidGameMakerProjectFileError {
    return Core.isErrorLike(value) && value.name === INVALID_GAME_MAKER_PROJECT_FILE_ERROR_NAME;
}

/**
 * Validate and normalize a `.yyp` path selected by the graph visualization UI.
 *
 * The UI open workflow requires a regular file containing a GameMaker project
 * manifest. Directory discovery and other CLI workflows remain responsible
 * for their existing project-target behavior.
 */
export async function validateGameMakerProjectFilePath(selectedPath: string): Promise<string> {
    const resolvedPath = path.resolve(selectedPath);
    if (path.extname(resolvedPath).toLowerCase() !== GAME_MAKER_PROJECT_FILE_EXTENSION) {
        throw new InvalidGameMakerProjectFileError(
            `Open a GameMaker project by selecting its .yyp file: ${resolvedPath}`
        );
    }

    let selectedFileStats: Awaited<ReturnType<typeof stat>>;
    try {
        selectedFileStats = await stat(resolvedPath);
    } catch (error: unknown) {
        throw new InvalidGameMakerProjectFileError(
            `The selected GameMaker project file could not be read: ${resolvedPath} (${Core.getErrorMessage(error)})`
        );
    }

    if (!selectedFileStats.isFile()) {
        throw new InvalidGameMakerProjectFileError(`The selected .yyp path is not a file: ${resolvedPath}`);
    }

    let projectDocument: Record<string, unknown>;
    try {
        const rawContents = await readFile(resolvedPath, "utf8");
        projectDocument = Core.parseProjectMetadataDocument(rawContents, resolvedPath) as Record<string, unknown>;
    } catch (error: unknown) {
        throw new InvalidGameMakerProjectFileError(
            `The selected file is not a valid GameMaker project manifest: ${resolvedPath} (${Core.getErrorMessage(error)})`
        );
    }

    if (
        projectDocument.resourceType !== "GMProject" ||
        typeof projectDocument.name !== "string" ||
        projectDocument.name.trim().length === 0 ||
        !Array.isArray(projectDocument.resources)
    ) {
        throw new InvalidGameMakerProjectFileError(
            `The selected file is not a valid GameMaker project manifest: ${resolvedPath}`
        );
    }

    return resolvedPath;
}
