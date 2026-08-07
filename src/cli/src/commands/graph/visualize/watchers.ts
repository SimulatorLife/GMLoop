import { createHash } from "node:crypto";
import { existsSync, type FSWatcher, readFile, watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findRepoRootSync } from "../../../shared/repo-root.js";
import {
    readGameMakerCliActiveProjectStateProjectPath,
    resolveGameMakerCliActiveProjectStatePath
} from "../../../workflow/project-root.js";
import type {
    GraphVisualizationActiveProjectStateWatcher,
    GraphVisualizationFeatherMetadataWatcher,
    GraphVisualizationFeatherMetadataWatchFactory,
    GraphVisualizationUiSourceWatchFactory
} from "./types.js";

function startGraphVisualizationUiSourceWatcher({
    watchRoot,
    onReloadCandidate,
    onError,
    watchFactory = watch
}: Readonly<{
    watchRoot: string;
    onReloadCandidate: (fileName: string | Buffer | null) => void;
    onError: (error: unknown) => void;
    watchFactory?: GraphVisualizationUiSourceWatchFactory;
}>): FSWatcher {
    const watcher = watchFactory(watchRoot, { recursive: true }, (_eventType, fileName) => {
        onReloadCandidate(fileName);
    });

    watcher.on("error", (error) => {
        onError(error);
        watcher.close();
    });

    return watcher;
}

function startGraphVisualizationFeatherMetadataWatcher({
    featherMetadataPath,
    onChanged,
    onError,
    watchFactory = watch,
    readFileFn = readFile as unknown as (path: string, options: "utf8") => Promise<string>
}: Readonly<{
    featherMetadataPath: string;
    onChanged: () => void | Promise<void>;
    onError: (error: unknown) => void;
    watchFactory?: GraphVisualizationFeatherMetadataWatchFactory;
    readFileFn?: (path: string, options: "utf8") => Promise<string>;
}>): GraphVisualizationFeatherMetadataWatcher {
    let watcher: FSWatcher | null = null;
    let stopped = false;
    let lastFeatherMetadataHash = "";

    void (async () => {
        if (stopped) {
            return;
        }
        try {
            const content = await readFileFn(featherMetadataPath, "utf8");
            lastFeatherMetadataHash = createHash("sha256").update(content).digest("hex");
        } catch {
            // Ignore initial read error
        }

        if (stopped) {
            return;
        }

        try {
            watcher = watchFactory(featherMetadataPath, (eventType) => {
                if (eventType === "change" && !stopped) {
                    void (async () => {
                        try {
                            const content = await readFileFn(featherMetadataPath, "utf8");
                            const currentHash = createHash("sha256").update(content).digest("hex");
                            if (currentHash === lastFeatherMetadataHash) {
                                return;
                            }
                            lastFeatherMetadataHash = currentHash;
                            if (!stopped) {
                                await onChanged();
                            }
                        } catch (error) {
                            onError(error);
                        }
                    })();
                }
            });
            watcher.on("error", (error) => {
                onError(error);
            });
        } catch (error) {
            onError(error);
        }
    })();

    return {
        close: () => {
            stopped = true;
            if (watcher) {
                watcher.close();
                watcher = null;
            }
        }
    };
}

function startGraphVisualizationActiveProjectStateWatcher({
    env,
    intervalMs = 500,
    onError,
    onProjectPathChanged,
    statePathOption
}: Readonly<{
    env: NodeJS.ProcessEnv;
    intervalMs?: number;
    onError: (error: unknown) => void;
    onProjectPathChanged: (projectPath: string) => Promise<void> | void;
    statePathOption?: string;
}>): GraphVisualizationActiveProjectStateWatcher {
    const statePath = resolveGameMakerCliActiveProjectStatePath({ env, statePathOption });
    let stopped = false;
    let observedProjectPath: string | null = null;
    let pollTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

    const scheduleNextPoll = (): void => {
        if (stopped) {
            return;
        }

        pollTimer = globalThis.setTimeout(() => {
            pollTimer = null;
            void pollActiveProjectState();
        }, intervalMs);
    };

    const pollActiveProjectState = async (): Promise<void> => {
        if (stopped) {
            return;
        }

        try {
            const projectPath = await readGameMakerCliActiveProjectStateProjectPath({ statePath });
            if (projectPath === null || projectPath === observedProjectPath) {
                observedProjectPath = projectPath;
                return;
            }

            observedProjectPath = projectPath;
            await onProjectPathChanged(projectPath);
        } catch (error) {
            onError(error);
        } finally {
            scheduleNextPoll();
        }
    };

    void pollActiveProjectState();

    return Object.freeze({
        stop: () => {
            stopped = true;
            if (pollTimer !== null) {
                globalThis.clearTimeout(pollTimer);
                pollTimer = null;
            }
        }
    });
}

function isGraphVisualizationUiSourceReloadCandidate(fileName: string | null): boolean {
    return fileName !== null && (fileName.endsWith(".ts") || fileName.endsWith(".css") || fileName.endsWith(".html"));
}

function normalizeGraphVisualizationUiSourceWatchFileName(fileName: string | Buffer | null): string | null {
    if (fileName === null) {
        return null;
    }

    return typeof fileName === "string" ? fileName : fileName.toString("utf8");
}

function resolveGraphVisualizationUiSourceWatchRoot(): string | null {
    const repoRoot = findRepoRootSync(path.dirname(fileURLToPath(import.meta.url)));
    const sourceRoot = path.resolve(repoRoot, "src/ui/src");
    if (!existsSync(sourceRoot)) {
        return null;
    }

    return sourceRoot;
}

export {
    isGraphVisualizationUiSourceReloadCandidate,
    normalizeGraphVisualizationUiSourceWatchFileName,
    resolveGraphVisualizationUiSourceWatchRoot,
    startGraphVisualizationActiveProjectStateWatcher,
    startGraphVisualizationFeatherMetadataWatcher,
    startGraphVisualizationUiSourceWatcher
};
