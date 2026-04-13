import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import type { Socket } from "node:net";
import path from "node:path";

import { Core } from "@gmloop/core";

import type { ServerEndpoint, ServerLifecycle } from "../server/index.js";

const { isErrorWithCode, getErrorMessage } = Core;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 0;
const MIME_TYPES = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "application/javascript; charset=utf-8"],
    [".mjs", "application/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".jpeg", "image/jpeg"],
    [".gif", "image/gif"],
    [".wasm", "application/wasm"],
    [".txt", "text/plain; charset=utf-8"],
    [".ico", "image/x-icon"]
]);

interface RuntimeHttpError extends Error {
    statusCode: number;
}

export interface RuntimeStaticServerOptions {
    runtimeRoot?: string;
    host?: string;
    port?: number;
    verbose?: boolean;
}

/**
 * Runtime-specific server properties.
 *
 * Provides origin URL and filesystem root specific to the HTML5 runtime static server.
 */
export interface RuntimeServerProperties {
    readonly origin: string;
    readonly root: string;
}

/**
 * Minimal runtime server contract for consumers that only need to know
 * where the server is running and how to stop it.
 */
export type RuntimeStaticServerHandle = ServerEndpoint & ServerLifecycle;

/**
 * Complete runtime server details for callers that also require runtime-specific
 * origin and filesystem information.
 */
export type RuntimeStaticServerInstance = RuntimeStaticServerHandle & RuntimeServerProperties;

function createRuntimeHttpError(message: string, statusCode: number): RuntimeHttpError {
    return Object.assign(new Error(message), { statusCode });
}

function getRuntimeHttpErrorStatus(error: unknown): number | null {
    if (!Core.isErrorLike(error)) {
        return null;
    }

    const statusCode = (error as unknown as Record<string, unknown>).statusCode;
    return typeof statusCode === "number" ? statusCode : null;
}

function formatRuntimeHttpErrorMessage(error: unknown, statusCode: number, fallbackMessage: string): string {
    if (statusCode === 403) {
        return "Forbidden";
    }

    if (Core.isErrorLike(error)) {
        return error.message;
    }

    return fallbackMessage;
}

function resolveMimeType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    return MIME_TYPES.get(extension) ?? "application/octet-stream";
}

function normalizeRequestPath(requestUrl) {
    if (typeof requestUrl !== "string" || requestUrl.length === 0) {
        return "/";
    }

    const queryIndex = requestUrl.indexOf("?");
    if (queryIndex === -1) {
        return requestUrl;
    }

    const pathOnly = requestUrl.slice(0, queryIndex);
    return pathOnly.length === 0 ? "/" : pathOnly;
}

function resolveRuntimeFilePath(root, requestPath) {
    let decoded;
    try {
        decoded = decodeURIComponent(requestPath);
    } catch {
        throw createRuntimeHttpError("Malformed request path.", 400);
    }
    const sanitizedPath = decoded.replaceAll("\\", "/");
    const sanitizedSegments = sanitizedPath.split("/").filter((segment) => segment && segment !== ".");

    if (sanitizedSegments.includes("..")) {
        throw createRuntimeHttpError("Request path resolves outside runtime root.", 403);
    }
    const normalizedPath = path.normalize(decoded).replaceAll("\\", "/");
    const strippedPath = normalizedPath.startsWith("/") ? normalizedPath.slice(1) : normalizedPath;
    const candidate = strippedPath.length === 0 ? "." : strippedPath;
    const target = path.resolve(root, candidate);
    const relative = path.relative(root, target);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw createRuntimeHttpError("Request path resolves outside runtime root.", 403);
    }

    return target;
}

async function sendFileResponse(res, filePath, { method }) {
    const stats = await fs.stat(filePath);
    let servingPath = filePath;

    if (stats.isDirectory()) {
        servingPath = path.join(filePath, "index.html");
    }

    const fileStats = await fs.stat(servingPath);

    if (!fileStats.isFile()) {
        throw createRuntimeHttpError("Requested resource is not a file.", 404);
    }

    const isWorldReadable = (fileStats.mode & 0o004) !== 0;
    const isGroupReadable = (fileStats.mode & 0o040) !== 0;
    const isOwnerReadable = (fileStats.mode & 0o400) !== 0;
    if (!isOwnerReadable && !isGroupReadable && !isWorldReadable) {
        throw createRuntimeHttpError("Requested resource is not readable.", 500);
    }

    const mimeType = resolveMimeType(servingPath);
    res.statusCode = 200;
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "no-store");

    if (method === "HEAD") {
        res.end();
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(servingPath);
        let errorHandled = false;

        const cleanup = (error?: unknown) => {
            if (errorHandled) {
                return;
            }
            errorHandled = true;

            // Remove specific listeners to prevent memory leaks
            stream.removeListener("error", cleanup);
            stream.removeListener("close", handleStreamClose);
            res.removeListener("close", handleResponseClose);
            res.removeListener("error", handleResponseError);

            // Destroy the stream if it's still open
            if (stream.readable || !stream.destroyed) {
                stream.destroy();
            }

            if (error) {
                const errorToReject = Core.isErrorLike(error)
                    ? error
                    : new Error(
                          getErrorMessage(error, {
                              fallback: "Stream error"
                          })
                      );
                reject(errorToReject);
            } else {
                resolve();
            }
        };

        const handleStreamClose = () => {
            cleanup();
        };

        const handleResponseClose = () => {
            // Response closed by client - clean up the stream
            cleanup();
        };

        const handleResponseError = (error: unknown) => {
            // Response encountered an error - clean up the stream
            cleanup(error);
        };

        stream.on("error", cleanup);
        stream.on("close", handleStreamClose);

        // Critical: Monitor response lifecycle to prevent stream leaks when client disconnects
        res.on("close", handleResponseClose);
        res.on("error", handleResponseError);

        stream.pipe(res);
    });
}

function writeError(res, statusCode, message) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(message);
}

export async function startRuntimeStaticServer({
    runtimeRoot,
    host = DEFAULT_HOST,
    port = DEFAULT_PORT,
    verbose = false
}: RuntimeStaticServerOptions = {}): Promise<RuntimeStaticServerInstance> {
    if (!runtimeRoot || typeof runtimeRoot !== "string") {
        throw new TypeError("startRuntimeStaticServer requires a runtimeRoot string.");
    }

    const resolvedRoot = path.resolve(runtimeRoot);

    const initialStats = await fs.stat(resolvedRoot).catch((error) => {
        if (isErrorWithCode(error, "ENOENT")) {
            throw new Error(`Runtime root '${resolvedRoot}' does not exist. Did hydration succeed?`);
        }
        throw error;
    });

    if (!initialStats.isDirectory()) {
        throw new Error(`Runtime root '${resolvedRoot}' is not a directory.`);
    }

    const activeSockets = new Set<Socket>();

    const server = http.createServer((req, res) => {
        const method = req.method ?? "GET";
        if (method !== "GET" && method !== "HEAD") {
            writeError(res, 405, "Method Not Allowed");
            return;
        }

        const requestPath = normalizeRequestPath(req.url ?? "/");
        let targetPath;

        try {
            targetPath = resolveRuntimeFilePath(resolvedRoot, requestPath);
        } catch (error) {
            const statusCode = getRuntimeHttpErrorStatus(error) ?? 500;
            const message = formatRuntimeHttpErrorMessage(error, statusCode, "Internal Server Error");
            if (statusCode >= 500) {
                console.error("Runtime static server request error:", error);
            }
            writeError(res, statusCode, message);
            return;
        }

        if (targetPath.endsWith(path.sep)) {
            targetPath = targetPath.slice(0, -1);
        }

        sendFileResponse(res, targetPath, { method }).catch((error) => {
            const statusCode = getRuntimeHttpErrorStatus(error) ?? (isErrorWithCode(error, "ENOENT") ? 404 : 500);
            const fallbackMessage =
                statusCode === 404
                    ? "Not Found"
                    : `Failed to read runtime asset: ${getErrorMessage(error, { fallback: "Unknown error" })}`;
            const message = formatRuntimeHttpErrorMessage(error, statusCode, fallbackMessage);
            if (statusCode >= 500) {
                console.error("Runtime static server failed to read asset:", error);
            }
            writeError(res, statusCode, message);
        });
    });

    server.on("connection", (socket) => {
        activeSockets.add(socket);

        socket.once("close", () => {
            activeSockets.delete(socket);
        });
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen({ host, port }, () => {
            server.off("error", reject);
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address !== "object" || !("port" in address)) {
        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });

        throw new Error("Failed to determine runtime static server address.");
    }

    const resolvedHost = host ?? DEFAULT_HOST;
    const resolvedPort = address.port;
    const origin = `http://${resolvedHost}:${resolvedPort}`;

    if (verbose) {
        console.log(`Serving HTML5 runtime from ${resolvedRoot} at ${origin}`);
    }

    let closed = false;

    async function stop() {
        if (closed) {
            return;
        }
        closed = true;

        for (const socket of activeSockets) {
            socket.destroy();
        }
        activeSockets.clear();

        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                } else {
                    resolve();
                }
            });
        });
    }

    return {
        url: `${origin}/`,
        origin,
        host: resolvedHost,
        port: resolvedPort,
        root: resolvedRoot,
        stop
    };
}
