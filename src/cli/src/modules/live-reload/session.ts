import path from "node:path";

import { runWatchCommand, type WatchCommandOptions } from "../../commands/watch.js";
import { resolveCommandProjectContext } from "../../workflow/project-root.js";
import { syncLiveReloadAssets } from "./asset-sync.js";
import {
    DEFAULT_GM_TEMP_ROOT,
    type LiveReloadAssetSyncResult,
    type LiveReloadBootstrapConfig,
    type LiveReloadTarget,
    resolveLiveReloadBootstrapScriptSrc
} from "./config.js";
import {
    buildGameMakerHtml5Output,
    type GameMakerHtml5BuildResult,
    resolveLiveReloadProjectBuildSettings
} from "./game-maker-build.js";
import { injectLiveReloadBootstrap } from "./html-injector.js";
import { resolveLiveReloadTarget } from "./target-resolution.js";

export interface PrepareLiveReloadOptions {
    html5OutputRoot?: string | null;
    gmTempRoot?: string;
    bootstrapConfig: LiveReloadBootstrapConfig;
    runtimeWrapperDistRoot?: string;
    force?: boolean;
}

export interface PrepareLiveReloadResult {
    target: LiveReloadTarget;
    assets: LiveReloadAssetSyncResult;
    injected: boolean;
}

export interface StartLiveReloadDevSessionOptions {
    targetPath: string;
    html5OutputRoot?: string | null;
    gmTempRoot?: string;
    bootstrapConfig: LiveReloadBootstrapConfig;
    runtimeWrapperDistRoot?: string;
    watchOptions?: WatchCommandOptions;
    buildRunner?: typeof buildGameMakerHtml5Output;
    prepareRunner?: typeof prepareLiveReload;
    projectContextResolver?: typeof resolveCommandProjectContext;
    settingsResolver?: typeof resolveLiveReloadProjectBuildSettings;
    watchRunner?: typeof runWatchCommand;
}

/**
 * Resolve and run the configured GameMaker HTML5 build for a live-reload
 * project.
 */
export async function buildLiveReloadHtml5Output({
    targetPath,
    buildRunner = buildGameMakerHtml5Output,
    projectContextResolver = resolveCommandProjectContext,
    settingsResolver = resolveLiveReloadProjectBuildSettings
}: Readonly<{
    targetPath: string;
    buildRunner?: typeof buildGameMakerHtml5Output;
    projectContextResolver?: typeof resolveCommandProjectContext;
    settingsResolver?: typeof resolveLiveReloadProjectBuildSettings;
}>): Promise<GameMakerHtml5BuildResult> {
    const projectContext = await projectContextResolver({
        path: targetPath
    });
    const projectSettings = await settingsResolver(projectContext.projectRoot, projectContext.projectConfig);
    if (projectSettings.buildConfig === null) {
        throw new Error(
            "GameMaker HTML5 build is not configured. Add runtime.liveReload.build and runtime.liveReload.html5Output to gmloop.json."
        );
    }

    return await buildRunner({
        buildConfig: projectSettings.buildConfig,
        cwd: projectContext.projectRoot
    });
}

export async function prepareLiveReload({
    html5OutputRoot = null,
    gmTempRoot = DEFAULT_GM_TEMP_ROOT,
    bootstrapConfig,
    runtimeWrapperDistRoot,
    force = false
}: PrepareLiveReloadOptions): Promise<PrepareLiveReloadResult> {
    const target = await resolveLiveReloadTarget({
        html5OutputRoot,
        gmTempRoot
    });
    const assets = await syncLiveReloadAssets({
        outputRoot: target.outputRoot,
        bootstrapConfig,
        runtimeWrapperDistRoot
    });
    const injected = await injectLiveReloadBootstrap({
        indexHtmlPath: target.indexHtmlPath,
        bootstrapScriptSrc: resolveLiveReloadBootstrapScriptSrc(),
        force
    });

    return Object.freeze({
        target,
        assets,
        injected
    });
}

export async function startLiveReloadDevSession({
    targetPath,
    html5OutputRoot = null,
    gmTempRoot = DEFAULT_GM_TEMP_ROOT,
    bootstrapConfig,
    runtimeWrapperDistRoot,
    watchOptions = {},
    buildRunner = buildGameMakerHtml5Output,
    prepareRunner = prepareLiveReload,
    projectContextResolver = resolveCommandProjectContext,
    settingsResolver = resolveLiveReloadProjectBuildSettings,
    watchRunner = runWatchCommand
}: StartLiveReloadDevSessionOptions): Promise<void> {
    const projectContext = await projectContextResolver({
        path: targetPath
    });
    const projectSettings = await settingsResolver(projectContext.projectRoot, projectContext.projectConfig);
    const configuredHtml5OutputRoot = projectSettings.html5OutputRoot;
    const requestedHtml5OutputRoot = html5OutputRoot ? resolveRequestedPath(html5OutputRoot) : null;
    const effectiveGmTempRoot = gmTempRoot === DEFAULT_GM_TEMP_ROOT ? projectSettings.gmTempRoot : gmTempRoot;

    let effectiveHtml5OutputRoot = requestedHtml5OutputRoot ?? configuredHtml5OutputRoot;
    if (projectSettings.buildConfig !== null) {
        if (configuredHtml5OutputRoot === null) {
            throw new Error(
                "GameMaker HTML5 build requires runtime.liveReload.html5Output to be configured in gmloop.json."
            );
        }

        if (requestedHtml5OutputRoot !== null && requestedHtml5OutputRoot !== configuredHtml5OutputRoot) {
            throw new Error(
                `Configured GameMaker HTML5 build output '${configuredHtml5OutputRoot}' conflicts with explicit --html5-output '${requestedHtml5OutputRoot}'.`
            );
        }

        const buildResult = await buildRunner({
            buildConfig: projectSettings.buildConfig,
            cwd: projectContext.projectRoot
        });
        effectiveHtml5OutputRoot = buildResult.outputRoot;
    }

    const preparation = await prepareRunner({
        html5OutputRoot: effectiveHtml5OutputRoot,
        gmTempRoot: effectiveGmTempRoot,
        bootstrapConfig,
        runtimeWrapperDistRoot,
        force: false
    });

    await watchRunner(targetPath, {
        ...watchOptions,
        runtimeRoot: preparation.target.outputRoot
    });
}

function resolveRequestedPath(inputPath: string): string {
    return path.resolve(inputPath);
}
