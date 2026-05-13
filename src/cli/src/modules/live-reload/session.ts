import { runWatchCommand, type WatchCommandOptions } from "../../commands/watch.js";
import { syncLiveReloadAssets } from "./asset-sync.js";
import {
    DEFAULT_GM_TEMP_ROOT,
    type LiveReloadAssetSyncResult,
    type LiveReloadBootstrapConfig,
    type LiveReloadTarget,
    resolveLiveReloadBootstrapScriptSrc
} from "./config.js";
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
    watchOptions = {}
}: StartLiveReloadDevSessionOptions): Promise<void> {
    await prepareLiveReload({
        html5OutputRoot,
        gmTempRoot,
        bootstrapConfig,
        runtimeWrapperDistRoot,
        force: false
    });

    await runWatchCommand(targetPath, watchOptions);
}
