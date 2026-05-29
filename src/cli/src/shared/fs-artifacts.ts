import type { Dirent, Stats } from "node:fs";
import { writeFile as writeFileAsync } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import { ensureWorkflowPathsAllowed } from "../workflow/path-filter.js";
import { ensureDir } from "./ensure-dir.js";

const {
    isNonEmptyString,
    stringifyJsonForFile,
    safeStat: coreSafeStat,
    safeReaddirWithFileTypes: coreSafeReaddirWithFileTypes
} = Core;

type WorkflowPathFilter = Parameters<typeof ensureWorkflowPathsAllowed>[0];

/**
 * Safely attempt to retrieve file statistics, returning `null` if the file
 * does not exist or any other error occurs. This pattern appears throughout
 * the CLI when probing for optional paths or checking whether a file exists
 * before attempting to read or process it.
 *
 * @param {string} targetPath Path to the file or directory to stat.
 * @returns {Promise<Stats | null>} File stats when the path exists and is accessible, otherwise `null`.
 * @deprecated Use {@link Core.safeStat} instead.
 */
export function safeStatOrNull(targetPath: string): Promise<Stats | null> {
    return coreSafeStat(targetPath);
}

/**
 * Safely attempt to read directory entries, returning an empty array if the
 * directory does not exist or any other error occurs. This mirrors the
 * safeStat pattern for directory listing operations.
 *
 * @param {string} directoryPath Path to the directory to read.
 * @param {object} options Options to pass to readdir.
 * @returns {Promise<Dirent[]>} Directory entries when accessible, otherwise an empty array.
 * @deprecated Use {@link Core.safeReaddirWithFileTypes} instead.
 */
export async function safeReaddirOrEmpty(directoryPath: string, options: { withFileTypes: true }): Promise<Dirent[]>;
export async function safeReaddirOrEmpty(directoryPath: string, options?: { withFileTypes?: false }): Promise<string[]>;
export async function safeReaddirOrEmpty(
    directoryPath: string,
    options?: { withFileTypes?: boolean }
): Promise<Dirent[] | string[]> {
    const entries = await coreSafeReaddirWithFileTypes(directoryPath);
    if (options?.withFileTypes) {
        return entries;
    }
    return entries.map((entry) => entry.name);
}

export interface FileArtifactWriteDetails {
    outputPath: string;
    contents: string;
    encoding: BufferEncoding;
}

export interface FileArtifactOptions {
    outputPath: string;
    contents: string;
    encoding?: BufferEncoding;
    onAfterWrite?: (details: FileArtifactWriteDetails) => void;
    writeFile?: typeof writeFileAsync;
    pathFilter?: WorkflowPathFilter;
}

/**
 * Write text contents to disk while guaranteeing the parent directory exists
 * before persisting the payload.
 *
 * @param {{
 *   outputPath: string,
 *   contents: string,
 *   encoding?: BufferEncoding,
 *   onAfterWrite?: (details: {
 *     outputPath: string,
 *     contents: string,
 *     encoding: BufferEncoding
 *   }) => void,
 *   writeFile?: typeof writeFileAsync,
 *   pathFilter?: Parameters<typeof ensureWorkflowPathsAllowed>[0]
 * }} options
 * @returns {Promise<void>}
 */
export async function writeFileArtifact({
    outputPath,
    contents,
    encoding = "utf8",
    onAfterWrite,
    writeFile = writeFileAsync,
    pathFilter
}: FileArtifactOptions): Promise<void> {
    if (!isNonEmptyString(outputPath)) {
        throw new TypeError("outputPath must be provided to writeFileArtifact.");
    }

    const directory = path.dirname(outputPath);

    ensureWorkflowPathsAllowed(pathFilter, [
        {
            type: "path",
            target: outputPath,
            label: "Artefact output path"
        },
        {
            type: "directory",
            target: directory,
            label: "Artefact directory"
        }
    ]);

    await ensureDir(directory);
    await writeFile(outputPath, contents, encoding);

    if (typeof onAfterWrite === "function") {
        onAfterWrite({ outputPath, contents, encoding });
    }
}

/**
 * Serialize a payload as JSON and persist it via {@link writeFileArtifact}.
 * Callers can override the JSON formatting knobs while reusing the shared
 * filesystem ceremony around directory creation and write hooks.
 *
 * @param {{
 *   outputPath: string,
 *   payload: unknown,
 *   replacer?: Parameters<typeof JSON.stringify>[1],
 *   space?: Parameters<typeof JSON.stringify>[2],
 *   includeTrailingNewline?: boolean,
 *   onAfterWrite?: Parameters<typeof writeFileArtifact>[0]["onAfterWrite"],
 *   encoding?: BufferEncoding,
 *   writeFile?: typeof writeFileAsync,
 *   pathFilter?: Parameters<typeof ensureWorkflowPathsAllowed>[0]
 * }} options
 * @returns {Promise<void>}
 */
export interface JsonArtifactOptions {
    outputPath: string;
    payload: unknown;
    replacer?: Parameters<typeof JSON.stringify>[1];
    space?: Parameters<typeof JSON.stringify>[2];
    includeTrailingNewline?: boolean;
    onAfterWrite?: FileArtifactOptions["onAfterWrite"];
    encoding?: BufferEncoding;
    writeFile?: typeof writeFileAsync;
    pathFilter?: WorkflowPathFilter;
}

export async function writeJsonArtifact({
    outputPath,
    payload,
    replacer,
    space = 2,
    includeTrailingNewline = true,
    onAfterWrite,
    encoding = "utf8",
    writeFile,
    pathFilter
}: JsonArtifactOptions): Promise<void> {
    const contents = stringifyJsonForFile(payload, {
        replacer,
        space,
        includeTrailingNewline
    });

    await writeFileArtifact({
        outputPath,
        contents,
        encoding,
        onAfterWrite,
        writeFile,
        pathFilter
    });
}
