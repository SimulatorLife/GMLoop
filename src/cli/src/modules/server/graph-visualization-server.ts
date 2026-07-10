import { spawn } from "node:child_process";
import * as http from "node:http";
import type { Socket } from "node:net";

import { Core } from "@gmloop/core";
import { UI } from "@gmloop/ui";

import { tryParseJsonPayload } from "../../shared/error-guards.js";
import type { ServerEndpoint, ServerLifecycle } from "./server-contracts.js";

type GraphVisualizationServerRenderBundle = (
    isServerMode: boolean
) => Promise<GraphVisualizationBundleArtifact> | GraphVisualizationBundleArtifact;

type GraphVisualizationServerRegenerationResult = Readonly<{
    changed: boolean;
    projectChanged?: boolean;
}>;

type GraphVisualizationServerRegenerate = () => Promise<GraphVisualizationServerRegenerationResult>;
type GraphVisualizationServerOpenProjectTargets = (
    input: Readonly<{ path: string | null }>
) => Promise<GraphVisualizationServerRegenerationResult>;

export type GraphVisualizationServerPlaygroundFixture = Readonly<{
    caseId: string;
    kind: string;
    inputGml: string;
    expectedGml: string | null;
    config: Record<string, unknown>;
}>;

type GraphVisualizationServerGetPlaygroundFixtures = () => Promise<
    ReadonlyArray<GraphVisualizationServerPlaygroundFixture>
>;

type GraphVisualizationServerProcessPlayground = (
    input: Readonly<{
        gml: string;
        formatOptionNames: ReadonlyArray<string>;
        format: boolean;
        lint: boolean;
        lintRuleIds: ReadonlyArray<string>;
        refactor: boolean;
        codemodIds: ReadonlyArray<string>;
        transpileMode: "none" | "patch" | "expression";
        fixtureId?: string;
    }>
) => Promise<Readonly<{ ast: string; output: string; error: string | null }>>;

type GraphVisualizationServerStartLiveReload = (
    input: Readonly<{
        restart: boolean;
    }>
) => Promise<unknown>;

type GraphVisualizationServerStopLiveReload = () => Promise<unknown>;

type GraphVisualizationProjectWorkflow = (typeof UI.PROJECT_WORKFLOWS)[number];
type GraphVisualizationServerRunFix = (
    input: Readonly<{ workflow: GraphVisualizationProjectWorkflow }>
) => Promise<Readonly<{ logLines: ReadonlyArray<string> }>>;
type GraphVisualizationServerFixProgress = Readonly<{
    isRunning: boolean;
    logLines: ReadonlyArray<string>;
    status?: string;
    workflow?: GraphVisualizationProjectWorkflow;
}>;
type GraphVisualizationServerGetFixProgress = () => GraphVisualizationServerFixProgress;
type GraphVisualizationServerClearFixProgress = () => void;
type GraphVisualizationServerCreateConfig = () => Promise<GraphVisualizationServerRegenerationResult>;
type GraphVisualizationServerSaveConfig = (
    input: Readonly<{ config: Readonly<Record<string, unknown>> }>
) => Promise<GraphVisualizationServerRegenerationResult>;
type GraphVisualizationServerInitializeAutoGameAgentPack = (
    input: Readonly<{
        agentTargets: ReadonlyArray<"codex" | "gemini" | "qwen">;
        includeGitIgnore: boolean;
        includeVSCode: boolean;
    }>
) => Promise<GraphVisualizationServerRegenerationResult>;
type GraphVisualizationServerSetAutoGameSkillEnabled = (
    input: Readonly<{ enabled: boolean; name: string }>
) => Promise<GraphVisualizationServerRegenerationResult>;

export type GraphVisualizationServerOptions = Readonly<{
    host?: string;
    port?: number;
    getUiRevision?: () => number;
    regenerate: GraphVisualizationServerRegenerate;
    renderBundle: GraphVisualizationServerRenderBundle;
    openProjectTargets?: GraphVisualizationServerOpenProjectTargets;
    processPlayground?: GraphVisualizationServerProcessPlayground;
    runFix?: GraphVisualizationServerRunFix;
    getFixProgress?: GraphVisualizationServerGetFixProgress;
    clearFixProgress?: GraphVisualizationServerClearFixProgress;
    startLiveReload?: GraphVisualizationServerStartLiveReload;
    stopLiveReload?: GraphVisualizationServerStopLiveReload;
    createConfig?: GraphVisualizationServerCreateConfig;
    saveConfig?: GraphVisualizationServerSaveConfig;
    initializeAutoGameAgentPack?: GraphVisualizationServerInitializeAutoGameAgentPack;
    setAutoGameSkillEnabled?: GraphVisualizationServerSetAutoGameSkillEnabled;
    getPlaygroundFixtures?: GraphVisualizationServerGetPlaygroundFixtures;
}>;

export type GraphVisualizationServerHandle = ServerEndpoint &
    ServerLifecycle &
    Readonly<{
        server: http.Server;
    }>;

type GraphVisualizationBundleFile = Readonly<{
    bytes: Uint8Array;
    contentType: string;
    relativePath: string;
}>;

type GraphVisualizationBundleArtifact = Readonly<{
    entryHtmlPath: string;
    files: ReadonlyArray<GraphVisualizationBundleFile>;
}>;

const LIVE_RELOAD_RUNTIME_URL_MISSING_ERROR =
    "Live reload startup completed without a runtime URL. The start callback must finish the build, watcher, status server, and runtime static server setup before returning.";

/**
 * Start the HTTP server that hosts the graph visualization document and regeneration endpoint.
 */
export async function startGraphVisualizationServer(
    options: GraphVisualizationServerOptions
): Promise<GraphVisualizationServerHandle> {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 0;
    const activeSockets = new Set<Socket>();

    const server = http.createServer((request, response) => {
        void routeGraphVisualizationServerRequest(options, request, response);
    });

    server.on("connection", (socket) => {
        activeSockets.add(socket);
        socket.on("close", () => {
            activeSockets.delete(socket);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
        throw new Error("Failed to resolve graph visualization server address.");
    }

    const resolvedUrl = `http://${host}:${String(address.port)}`;

    return Object.freeze({
        host,
        port: address.port,
        server,
        stop: async () => {
            for (const socket of activeSockets) {
                socket.destroy();
            }
            activeSockets.clear();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve();
                });
            });
        },
        url: resolvedUrl
    });
}

async function routeGraphVisualizationServerRequest(
    options: GraphVisualizationServerOptions,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    if (handleUiRevisionRequest(request, response, options)) {
        return;
    }

    if (handleFixProgressRequest(request, response, options)) {
        return;
    }

    if (request.method === "GET" && request.url === "/api/playground/fixtures" && options.getPlaygroundFixtures) {
        await handleGetPlaygroundFixturesRequest(options.getPlaygroundFixtures, response);
        return;
    }

    if (request.method === "GET") {
        await handleStaticGraphVisualizationFileRequest(options, request, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/reindex") {
        await handleRegenerateRequest(options, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/fix" && options.runFix) {
        await handleRunFixRequest(options.runFix, options.clearFixProgress, request, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/open" && options.openProjectTargets) {
        await handleOpenProjectTargetsRequest(options.openProjectTargets, request, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/playground/process" && options.processPlayground) {
        await handleProcessPlaygroundRequest(options.processPlayground, request, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/live-reload/start" && options.startLiveReload) {
        await handleStartLiveReloadRequest(options.startLiveReload, request, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/live-reload/stop" && options.stopLiveReload) {
        await handleStopLiveReloadRequest(options.stopLiveReload, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/config/create" && options.createConfig) {
        await handleCreateConfigRequest(options.createConfig, response);
        return;
    }

    if (request.method === "POST" && request.url === "/api/config/save" && options.saveConfig) {
        await handleSaveConfigRequest(options.saveConfig, request, response);
        return;
    }

    if (
        request.method === "POST" &&
        request.url === "/api/auto-game/agent-pack/init" &&
        options.initializeAutoGameAgentPack
    ) {
        await handleInitializeAutoGameAgentPackRequest(options.initializeAutoGameAgentPack, request, response);
        return;
    }

    if (
        request.method === "POST" &&
        request.url === "/api/auto-game/skills/toggle" &&
        options.setAutoGameSkillEnabled
    ) {
        await handleSetAutoGameSkillEnabledRequest(options.setAutoGameSkillEnabled, request, response);
        return;
    }

    writeTextResponse(response, 404, "Not found");
}

function handleUiRevisionRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>,
    options: GraphVisualizationServerOptions
): boolean {
    if (request.method !== "GET" || request.url !== "/api/ui-revision") {
        return false;
    }

    writeJsonResponse(response, 200, { revision: options.getUiRevision ? options.getUiRevision() : 0 });
    return true;
}

async function handleStaticGraphVisualizationFileRequest(
    options: GraphVisualizationServerOptions,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const file = await resolveStaticGraphVisualizationFileForRequest(options, request.url);
        if (!file) {
            writeTextResponse(response, 404, "Not found");
            return;
        }

        response.writeHead(200, { "Content-Type": file.contentType });
        response.end(file.bytes);
    } catch (error: unknown) {
        writeTextResponse(response, 500, resolveErrorMessage(error));
    }
}

async function handleRegenerateRequest(
    options: GraphVisualizationServerOptions,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const regenerationResult = await options.regenerate();
        writeJsonResponse(response, 200, { changed: regenerationResult.changed, ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleRunFixRequest(
    runFix: GraphVisualizationServerRunFix,
    clearFixProgress: GraphVisualizationServerClearFixProgress | undefined,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const parsedBody = await readOptionalJsonObjectRequestBody(request);
        if (parsedBody === null) {
            writeInvalidJsonPayloadResponse(response);
            return;
        }
        const workflow = readProjectWorkflow(parsedBody.workflow);
        if (workflow === null) {
            writeJsonResponse(response, 400, { error: "Unknown project workflow." });
            return;
        }
        const fixResult = await runFix({ workflow });
        writeJsonResponse(response, 200, { logLines: fixResult.logLines, ok: true });
        clearFixProgress?.();
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
        clearFixProgress?.();
    }
}

function readProjectWorkflow(value: unknown): GraphVisualizationProjectWorkflow | null {
    return UI.PROJECT_WORKFLOWS.find((workflow) => workflow === value) ?? null;
}

async function handleOpenProjectTargetsRequest(
    openProjectTargets: GraphVisualizationServerOpenProjectTargets,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const parsedBody = await readOptionalJsonObjectRequestBody(request);
        if (parsedBody === null) {
            writeInvalidJsonPayloadResponse(response);
            return;
        }

        const selectedPath = typeof parsedBody.path === "string" ? parsedBody.path.trim() : "";
        const selectionResult = await openProjectTargets({
            path: selectedPath.length > 0 ? selectedPath : null
        });
        writeJsonResponse(response, 200, createOpenProjectTargetsResponse(selectionResult));
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleGetPlaygroundFixturesRequest(
    getPlaygroundFixtures: GraphVisualizationServerGetPlaygroundFixtures,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const fixtures = await getPlaygroundFixtures();
        writeJsonResponse(response, 200, { fixtures, ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleProcessPlaygroundRequest(
    processPlayground: GraphVisualizationServerProcessPlayground,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const requestBody = await readRequestBody(request);
        const parsedBody = tryParseJsonPayload(requestBody);
        if (parsedBody === null) {
            writeInvalidJsonPayloadResponse(response);
            return;
        }

        const playgroundInput = createProcessPlaygroundInput(parsedBody);
        const result = await processPlayground(playgroundInput);
        writeJsonResponse(response, 200, { ok: true, payload: result });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleStartLiveReloadRequest(
    startLiveReload: GraphVisualizationServerStartLiveReload,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const parsedBody = await readOptionalJsonObjectRequestBody(request);
        if (parsedBody === null) {
            writeInvalidJsonPayloadResponse(response);
            return;
        }

        const result = await startLiveReload({
            restart: parsedBody.restart === true
        });
        if (!hasLiveReloadRuntimeUrl(result)) {
            throw new Error(LIVE_RELOAD_RUNTIME_URL_MISSING_ERROR);
        }
        writeJsonResponse(response, 200, { liveReload: result, ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleStopLiveReloadRequest(
    stopLiveReload: GraphVisualizationServerStopLiveReload,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        await stopLiveReload();
        writeJsonResponse(response, 200, { ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleCreateConfigRequest(
    createConfig: GraphVisualizationServerCreateConfig,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const result = await createConfig();
        writeJsonResponse(response, 200, { changed: result.changed, ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleSaveConfigRequest(
    saveConfig: GraphVisualizationServerSaveConfig,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const parsedBody = await readOptionalJsonObjectRequestBody(request);
        if (parsedBody === null || !Core.isObjectLike(parsedBody.config) || Array.isArray(parsedBody.config)) {
            writeInvalidJsonPayloadResponse(response);
            return;
        }

        const result = await saveConfig({
            config: Object.freeze({ ...(parsedBody.config as Record<string, unknown>) })
        });
        writeJsonResponse(response, 200, { changed: result.changed, ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleInitializeAutoGameAgentPackRequest(
    initializeAutoGameAgentPack: GraphVisualizationServerInitializeAutoGameAgentPack,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const parsedBody = await readOptionalJsonObjectRequestBody(request);
        let includeGitIgnore = true;
        if (parsedBody !== null && parsedBody.includeGitIgnore !== undefined) {
            if (typeof parsedBody.includeGitIgnore !== "boolean") {
                writeInvalidJsonPayloadResponse(response);
                return;
            }
            includeGitIgnore = parsedBody.includeGitIgnore;
        }
        let includeVSCode = false;
        if (parsedBody !== null && parsedBody.includeVSCode !== undefined) {
            if (typeof parsedBody.includeVSCode !== "boolean") {
                writeInvalidJsonPayloadResponse(response);
                return;
            }
            includeVSCode = parsedBody.includeVSCode;
        }
        let agentTargets: ReadonlyArray<"codex" | "gemini" | "qwen"> = Object.freeze([]);
        if (parsedBody !== null && parsedBody.agentTargets !== undefined) {
            if (
                !Array.isArray(parsedBody.agentTargets) ||
                parsedBody.agentTargets.some(
                    (agentTarget) => agentTarget !== "codex" && agentTarget !== "gemini" && agentTarget !== "qwen"
                )
            ) {
                writeInvalidJsonPayloadResponse(response);
                return;
            }
            agentTargets = Object.freeze([...parsedBody.agentTargets]);
        }
        const result = await initializeAutoGameAgentPack({ agentTargets, includeGitIgnore, includeVSCode });
        writeJsonResponse(response, 200, { changed: result.changed, ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

async function handleSetAutoGameSkillEnabledRequest(
    setAutoGameSkillEnabled: GraphVisualizationServerSetAutoGameSkillEnabled,
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>
): Promise<void> {
    try {
        const parsedBody = await readOptionalJsonObjectRequestBody(request);
        if (
            parsedBody === null ||
            typeof parsedBody.name !== "string" ||
            parsedBody.name.trim().length === 0 ||
            typeof parsedBody.enabled !== "boolean"
        ) {
            writeInvalidJsonPayloadResponse(response);
            return;
        }
        const result = await setAutoGameSkillEnabled({
            enabled: parsedBody.enabled,
            name: parsedBody.name.trim()
        });
        writeJsonResponse(response, 200, { changed: result.changed, ok: true });
    } catch (error: unknown) {
        writeJsonResponse(response, 500, { error: resolveErrorMessage(error) });
    }
}

function createOpenProjectTargetsResponse(
    selectionResult: GraphVisualizationServerRegenerationResult
): Readonly<Record<string, unknown>> {
    return {
        changed: selectionResult.changed,
        ok: true,
        ...(selectionResult.projectChanged === undefined ? {} : { projectChanged: selectionResult.projectChanged })
    };
}

function hasLiveReloadRuntimeUrl(result: unknown): boolean {
    if (typeof result !== "object" || result === null || !("endpoints" in result)) {
        return false;
    }

    const endpoints = result.endpoints;
    if (typeof endpoints !== "object" || endpoints === null || !("runtimeUrl" in endpoints)) {
        return false;
    }

    return typeof endpoints.runtimeUrl === "string" && endpoints.runtimeUrl.trim().length > 0;
}

function createProcessPlaygroundInput(
    parsedBody: Record<string, unknown>
): Parameters<GraphVisualizationServerProcessPlayground>[0] {
    return {
        codemodIds: readStringListPayloadField(parsedBody, "codemodIds"),
        format: parsedBody.format === true,
        formatOptionNames: readStringListPayloadField(parsedBody, "formatOptionNames"),
        gml: typeof parsedBody.gml === "string" ? parsedBody.gml : "",
        lint: parsedBody.lint === true,
        lintRuleIds: readStringListPayloadField(parsedBody, "lintRuleIds"),
        refactor: parsedBody.refactor === true,
        transpileMode: readPlaygroundTranspileMode(parsedBody.transpileMode),
        fixtureId: typeof parsedBody.fixtureId === "string" ? parsedBody.fixtureId : undefined
    };
}

function readStringListPayloadField(parsedBody: Record<string, unknown>, fieldName: string): ReadonlyArray<string> {
    const fieldValue = parsedBody[fieldName];
    if (!Array.isArray(fieldValue)) {
        return [];
    }

    return fieldValue
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function readPlaygroundTranspileMode(value: unknown): "none" | "patch" | "expression" {
    return value === "patch" || value === "expression" ? value : "none";
}

async function readOptionalJsonObjectRequestBody(
    request: http.IncomingMessage
): Promise<Record<string, unknown> | null> {
    const requestBody = await readRequestBody(request);
    return requestBody.trim().length === 0 ? {} : tryParseJsonPayload(requestBody);
}

function writeInvalidJsonPayloadResponse(response: http.ServerResponse<http.IncomingMessage>): void {
    writeJsonResponse(response, 400, { error: "Invalid JSON or non-object payload" });
}

function writeJsonResponse(
    response: http.ServerResponse<http.IncomingMessage>,
    statusCode: number,
    payload: unknown
): void {
    response.writeHead(statusCode, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
}

function writeTextResponse(
    response: http.ServerResponse<http.IncomingMessage>,
    statusCode: number,
    body: string
): void {
    response.writeHead(statusCode, { "Content-Type": "text/plain" });
    response.end(body);
}

function handleFixProgressRequest(
    request: http.IncomingMessage,
    response: http.ServerResponse<http.IncomingMessage>,
    options: GraphVisualizationServerOptions
): boolean {
    if (request.method !== "GET" || request.url !== "/api/fix/progress" || !options.getFixProgress) {
        return false;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ...options.getFixProgress(), ok: true }));
    return true;
}

async function resolveStaticGraphVisualizationFileForRequest(
    options: GraphVisualizationServerOptions,
    requestUrl: string | undefined
): Promise<GraphVisualizationBundleFile | null> {
    const bundle = await options.renderBundle(true);
    const requestPathname = new URL(requestUrl ?? "/", "http://localhost").pathname;
    if (requestPathname === "/" || requestPathname === "") {
        return findGraphVisualizationBundleFile(bundle, bundle.entryHtmlPath);
    }

    const decodedPath = decodeURIComponent(requestPathname);
    const relativePath = decodedPath.startsWith("/") ? decodedPath.slice(1) : decodedPath;
    if (relativePath.length === 0 || relativePath.includes("..")) {
        return null;
    }

    return findGraphVisualizationBundleFile(bundle, relativePath);
}

function findGraphVisualizationBundleFile(
    bundle: GraphVisualizationBundleArtifact,
    relativePath: string
): GraphVisualizationBundleFile | null {
    return bundle.files.find((file) => file.relativePath === relativePath) ?? null;
}

/**
 * Resolve a human-readable message from an unknown error value.
 *
 * Uses a capability probe rather than `instanceof Error` so that cross-realm
 * errors (e.g. from sandboxed modules or worker threads) and custom error-like
 * objects are handled without relying on prototype-chain identity.
 */
function resolveErrorMessage(error: unknown): string {
    return Core.isErrorLike(error) ? error.message : "Unknown error";
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
    const chunks: Array<Buffer> = [];
    for await (const chunk of request) {
        if (typeof chunk === "string") {
            chunks.push(Buffer.from(chunk));
        } else {
            chunks.push(chunk);
        }
    }
    return Buffer.concat(chunks).toString("utf8");
}

/**
 * Open a URL in the system default browser.
 */
export function openUrlInDefaultBrowser(url: string): void {
    if (process.platform === "darwin") {
        spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
        return;
    }

    if (process.platform === "win32") {
        spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
        return;
    }

    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}
