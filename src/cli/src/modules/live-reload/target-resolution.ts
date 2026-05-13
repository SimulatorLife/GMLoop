import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import { safeStatOrNull } from "../../shared/index.js";
import { DEFAULT_GM_TEMP_ROOT, type LiveReloadTarget } from "./config.js";

export interface ResolveLiveReloadTargetOptions {
    html5OutputRoot?: string | null;
    gmTempRoot?: string;
}

interface Html5OutputCandidate {
    outputRoot: string;
    indexHtmlPath: string;
    mtimeMs: number;
}

async function resolveExplicitLiveReloadTarget(outputRoot: string): Promise<LiveReloadTarget> {
    const resolvedRoot = path.resolve(outputRoot);
    const indexHtmlPath = path.join(resolvedRoot, "index.html");
    const stats = await fs.stat(indexHtmlPath);

    if (!stats.isFile()) {
        throw new Error(`HTML5 output '${resolvedRoot}' does not contain an index.html file.`);
    }

    return Object.freeze({
        outputRoot: resolvedRoot,
        indexHtmlPath
    });
}

async function collectHtml5OutputCandidate(
    parentRoot: string,
    directoryName: string
): Promise<Html5OutputCandidate | null> {
    const outputRoot = path.join(parentRoot, directoryName);
    const indexHtmlPath = path.join(outputRoot, "index.html");
    const stats = await safeStatOrNull(indexHtmlPath);
    if (!stats?.isFile()) {
        return null;
    }

    return Object.freeze({
        outputRoot,
        indexHtmlPath,
        mtimeMs: stats.mtimeMs
    });
}

async function resolveNewestDetectedLiveReloadTarget(tempRoot: string): Promise<LiveReloadTarget> {
    const resolvedTempRoot = path.resolve(tempRoot);
    let entries: Array<Dirent>;

    try {
        entries = await fs.readdir(resolvedTempRoot, { withFileTypes: true });
    } catch (error) {
        const maybeFsError = error as NodeJS.ErrnoException;
        if (maybeFsError.code === "ENOENT") {
            throw new Error(
                `GameMaker HTML5 temporary output root '${resolvedTempRoot}' was not found. Run the HTML5 build once or pass --html5-output explicitly.`
            );
        }

        throw error;
    }

    const candidateResults = await Promise.all(
        entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => collectHtml5OutputCandidate(resolvedTempRoot, entry.name))
    );
    const candidates = candidateResults.filter((candidate): candidate is Html5OutputCandidate => candidate !== null);

    const bestCandidate = candidates.reduce<Html5OutputCandidate | null>((best, candidate) => {
        if (!best || candidate.mtimeMs > best.mtimeMs) {
            return candidate;
        }

        return best;
    }, null);

    if (!bestCandidate) {
        throw new Error(`No HTML5 index.html found under '${resolvedTempRoot}'. Run the HTML5 build first.`);
    }

    return Object.freeze({
        outputRoot: bestCandidate.outputRoot,
        indexHtmlPath: bestCandidate.indexHtmlPath
    });
}

export function resolveLiveReloadTarget({
    html5OutputRoot = null,
    gmTempRoot = DEFAULT_GM_TEMP_ROOT
}: ResolveLiveReloadTargetOptions = {}): Promise<LiveReloadTarget> {
    if (Core.isNonEmptyTrimmedString(html5OutputRoot)) {
        return resolveExplicitLiveReloadTarget(html5OutputRoot);
    }

    return resolveNewestDetectedLiveReloadTarget(gmTempRoot);
}
