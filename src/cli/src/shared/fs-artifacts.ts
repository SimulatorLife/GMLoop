import { writeFile as writeFileAsync } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import { ensureWorkflowPathsAllowed } from "../workflow/path-filter.js";
import { ensureDir } from "./ensure-dir.js";

const { isNonEmptyString, stringifyJsonForFile } = Core;

type WorkflowPathFilter = Parameters<typeof ensureWorkflowPathsAllowed>[0];

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
