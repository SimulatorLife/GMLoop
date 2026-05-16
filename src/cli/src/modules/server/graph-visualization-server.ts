import * as http from "node:http";
import type { Socket } from "node:net";

import { Core } from "@gmloop/core";

import { tryParseJsonPayload } from "../../shared/error-guards.js";
import type { ServerEndpoint, ServerLifecycle } from "./server-contracts.js";

type GraphVisualizationServerRenderBundle = (
    isServerMode: boolean
) => Promise<GraphVisualizationBundleArtifact> | GraphVisualizationBundleArtifact;

type GraphVisualizationServerRegenerationResult = Readonly<{
    changed: boolean;
}>;

type GraphVisualizationServerRegenerate = () => Promise<GraphVisualizationServerRegenerationResult>;
type GraphVisualizationServerOpenProjectTargets = (
    input: Readonly<{ path: string | null }>
) => Promise<GraphVisualizationServerRegenerationResult>;

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
    }>
) => Promise<Readonly<{ ast: string; output: string; error: string | null }>>;

type GraphVisualizationServerStartLiveReload = (
    input: Readonly<{
        restart: boolean;
    }>
) => Promise<unknown>;

type GraphVisualizationServerRunFix = () => Promise<Readonly<{ logLines: ReadonlyArray<string> }>>;

export type GraphVisualizationServerOptions = Readonly<{
    host?: string;
    port?: number;
    getUiRevision?: () => number;
    regenerate: GraphVisualizationServerRegenerate;
    renderBundle: GraphVisualizationServerRenderBundle;
    openProjectTargets?: GraphVisualizationServerOpenProjectTargets;
    processPlayground?: GraphVisualizationServerProcessPlayground;
    runFix?: GraphVisualizationServerRunFix;
    startLiveReload?: GraphVisualizationServerStartLiveReload;
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
        void (async () => {
            if (request.method === "GET" && request.url === "/api/ui-revision") {
                response.writeHead(200, { "Content-Type": "application/json" });
                response.end(JSON.stringify({ revision: options.getUiRevision ? options.getUiRevision() : 0 }));
                return;
            }

            if (request.method === "GET") {
                try {
                    const file = await resolveStaticGraphVisualizationFileForRequest(options, request.url);
                    if (!file) {
                        response.writeHead(404, { "Content-Type": "text/plain" });
                        response.end("Not found");
                        return;
                    }
                    response.writeHead(200, { "Content-Type": file.contentType });
                    response.end(file.bytes);
                } catch (error: unknown) {
                    response.writeHead(500, { "Content-Type": "text/plain" });
                    response.end(resolveErrorMessage(error));
                }
                return;
            }

            if (request.method === "POST" && request.url === "/api/reindex") {
                try {
                    const regenerationResult = await options.regenerate();
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ changed: regenerationResult.changed, ok: true }));
                } catch (error: unknown) {
                    response.writeHead(500, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: resolveErrorMessage(error) }));
                }
                return;
            }

            if (request.method === "POST" && request.url === "/api/fix" && options.runFix) {
                try {
                    const fixResult = await options.runFix();
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ logLines: fixResult.logLines, ok: true }));
                } catch (error: unknown) {
                    response.writeHead(500, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: resolveErrorMessage(error) }));
                }
                return;
            }

            if (request.method === "POST" && request.url === "/api/open" && options.openProjectTargets) {
                try {
                    const requestBody = await readRequestBody(request);
                    const parsedBody = requestBody.trim().length === 0 ? {} : tryParseJsonPayload(requestBody);
                    if (parsedBody === null) {
                        response.writeHead(400, { "Content-Type": "application/json" });
                        response.end(JSON.stringify({ error: "Invalid JSON or non-object payload" }));
                        return;
                    }
                    const selectedPath = typeof parsedBody.path === "string" ? String(parsedBody.path).trim() : "";
                    const selectionResult = await options.openProjectTargets({
                        path: selectedPath.length > 0 ? selectedPath : null
                    });
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ changed: selectionResult.changed, ok: true }));
                } catch (error: unknown) {
                    response.writeHead(500, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: resolveErrorMessage(error) }));
                }
                return;
            }

            if (request.method === "POST" && request.url === "/api/playground/process" && options.processPlayground) {
                try {
                    const requestBody = await readRequestBody(request);
                    const parsedBody = tryParseJsonPayload(requestBody);
                    if (parsedBody === null) {
                        response.writeHead(400, { "Content-Type": "application/json" });
                        response.end(JSON.stringify({ error: "Invalid JSON or non-object payload" }));
                        return;
                    }
                    const gml = typeof parsedBody.gml === "string" ? parsedBody.gml : "";
                    const formatOptionNames = Array.isArray(parsedBody.formatOptionNames)
                        ? parsedBody.formatOptionNames
                              .filter((optionName): optionName is string => typeof optionName === "string")
                              .map((optionName) => optionName.trim())
                              .filter((optionName) => optionName.length > 0)
                        : [];
                    const format = parsedBody.format === true;
                    const lint = parsedBody.lint === true;
                    const lintRuleIds = Array.isArray(parsedBody.lintRuleIds)
                        ? parsedBody.lintRuleIds
                              .filter((ruleId): ruleId is string => typeof ruleId === "string")
                              .map((ruleId) => ruleId.trim())
                              .filter((ruleId) => ruleId.length > 0)
                        : [];
                    const refactor = parsedBody.refactor === true;
                    const codemodIds = Array.isArray(parsedBody.codemodIds)
                        ? parsedBody.codemodIds
                              .filter((codemodId): codemodId is string => typeof codemodId === "string")
                              .map((codemodId) => codemodId.trim())
                              .filter((codemodId) => codemodId.length > 0)
                        : [];
                    const transpileMode =
                        parsedBody.transpileMode === "patch" || parsedBody.transpileMode === "expression"
                            ? parsedBody.transpileMode
                            : "none";

                    const result = await options.processPlayground({
                        gml,
                        formatOptionNames,
                        format,
                        lint,
                        lintRuleIds,
                        refactor,
                        codemodIds,
                        transpileMode
                    });
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ ok: true, payload: result }));
                } catch (error: unknown) {
                    response.writeHead(500, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: resolveErrorMessage(error) }));
                }
                return;
            }

            if (request.method === "POST" && request.url === "/api/live-reload/start" && options.startLiveReload) {
                try {
                    const requestBody = await readRequestBody(request);
                    const parsedBody = requestBody.trim().length === 0 ? {} : tryParseJsonPayload(requestBody);
                    if (parsedBody === null) {
                        response.writeHead(400, { "Content-Type": "application/json" });
                        response.end(JSON.stringify({ error: "Invalid JSON or non-object payload" }));
                        return;
                    }
                    const result = await options.startLiveReload({
                        restart: parsedBody.restart === true
                    });
                    response.writeHead(200, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ liveReload: result, ok: true }));
                } catch (error: unknown) {
                    response.writeHead(500, { "Content-Type": "application/json" });
                    response.end(JSON.stringify({ error: resolveErrorMessage(error) }));
                }
                return;
            }

            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end("Not found");
        })();
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
