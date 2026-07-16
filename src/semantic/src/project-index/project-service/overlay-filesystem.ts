import path from "node:path";

import { Core } from "@gmloop/core";

import type { ProjectIndexFsFacade } from "../fs-facade.js";
import type { SemanticOpenBufferOverlay } from "../semantic-manifest.js";
import { compareSemanticQueryText } from "../semantic-query-order.js";

type ReadFileOperation = (filePath: string, encoding: BufferEncoding) => Promise<string>;
type ReadDirectoryOperation = (directoryPath: string) => Promise<Iterable<string>>;
type StatOperation = (filePath: string) => Promise<{ mtimeMs?: number } | null>;

function requireReadFile(fsFacade: ProjectIndexFsFacade): ReadFileOperation {
    const readFile = fsFacade.readFile ?? Core.defaultFsFacade.readFile;
    if (readFile === undefined) {
        throw new Error("Semantic project services require a filesystem readFile operation.");
    }
    return readFile;
}

function requireReadDirectory(fsFacade: ProjectIndexFsFacade): ReadDirectoryOperation {
    const readDirectory = fsFacade.readDir ?? Core.defaultFsFacade.readDir;
    if (readDirectory === undefined) {
        throw new Error("Semantic project services require a filesystem readDir operation.");
    }
    return readDirectory;
}

function requireStat(fsFacade: ProjectIndexFsFacade): StatOperation {
    const stat = fsFacade.stat ?? Core.defaultFsFacade.stat;
    if (stat === undefined) {
        throw new Error("Semantic project services require a filesystem stat operation.");
    }
    return stat;
}

function classifyOverlayPath(candidatePath: string, overlayPaths: ReadonlyArray<string>): "directory" | "file" | null {
    const resolvedCandidate = path.resolve(candidatePath);
    for (const overlayPath of overlayPaths) {
        if (overlayPath === resolvedCandidate) {
            return "file";
        }
        const relativePath = path.relative(resolvedCandidate, overlayPath);
        if (relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
            return "directory";
        }
    }
    return null;
}

function createOverlayStats(kind: "directory" | "file"): {
    isDirectory: () => boolean;
    isFile: () => boolean;
    mtimeMs: number;
} {
    return Object.freeze({
        isDirectory: () => kind === "directory",
        isFile: () => kind === "file",
        mtimeMs: 0
    });
}

/** Create one immutable build-time filesystem view with editor overlays composed over disk. */
export function createSemanticOverlayFilesystem(
    fsFacade: ProjectIndexFsFacade,
    overlays: ReadonlyArray<SemanticOpenBufferOverlay>
): ProjectIndexFsFacade {
    const baseReadFile = requireReadFile(fsFacade);
    const baseReadDirectory = requireReadDirectory(fsFacade);
    const baseStat = requireStat(fsFacade);
    const overlaysByPath = new Map(overlays.map((overlay) => [path.resolve(overlay.absolutePath), overlay]));
    const overlayPaths = [...overlaysByPath.keys()];

    return Object.freeze({
        ...fsFacade,
        async readDir(directoryPath: string) {
            const resolvedDirectory = path.resolve(directoryPath);
            const entries = new Set<string>();
            try {
                for (const entry of await baseReadDirectory(resolvedDirectory)) {
                    entries.add(entry);
                }
            } catch (error) {
                if (!Core.isErrorWithCode(error, "ENOENT")) {
                    throw error;
                }
            }
            for (const overlayPath of overlayPaths) {
                const relativePath = path.relative(resolvedDirectory, overlayPath);
                if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
                    continue;
                }
                const [entry] = relativePath.split(path.sep);
                if (entry !== undefined && entry.length > 0) {
                    entries.add(entry);
                }
            }
            return [...entries].toSorted(compareSemanticQueryText);
        },
        readFile(filePath: string, encoding: BufferEncoding) {
            const overlay = overlaysByPath.get(path.resolve(filePath));
            return overlay === undefined ? baseReadFile(filePath, encoding) : Promise.resolve(overlay.sourceText);
        },
        stat(filePath: string) {
            const overlayKind = classifyOverlayPath(filePath, overlayPaths);
            if (overlayKind !== null) {
                return Promise.resolve(createOverlayStats(overlayKind));
            }
            return baseStat(filePath);
        }
    });
}
