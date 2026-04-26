import * as http from "node:http";

import type { ServerEndpoint, ServerLifecycle } from "./server-contracts.js";

type GraphVisualizationServerRenderHtml = (isServerMode: boolean) => Promise<string> | string;

type GraphVisualizationServerRegenerationResult = Readonly<{
    changed: boolean;
}>;

type GraphVisualizationServerRegenerate = () => Promise<GraphVisualizationServerRegenerationResult>;

export type GraphVisualizationServerOptions = Readonly<{
    host?: string;
    port?: number;
    regenerate: GraphVisualizationServerRegenerate;
    renderHtml: GraphVisualizationServerRenderHtml;
}>;

export type GraphVisualizationServerHandle = ServerEndpoint &
    ServerLifecycle &
    Readonly<{
        server: http.Server;
    }>;

/**
 * Start the HTTP server that hosts the graph visualization document and regeneration endpoint.
 */
export async function startGraphVisualizationServer(
    options: GraphVisualizationServerOptions
): Promise<GraphVisualizationServerHandle> {
    const host = options.host ?? "127.0.0.1";
    const port = options.port ?? 0;
    const activeSockets = new Set<import("node:net").Socket>();

    const server = http.createServer(async (request, response) => {
        if (request.method === "GET" && (request.url === "/" || request.url === "")) {
            try {
                const htmlContent = await options.renderHtml(true);
                response.writeHead(200, { "Content-Type": "text/html" });
                response.end(htmlContent);
            } catch (error: unknown) {
                response.writeHead(500, { "Content-Type": "text/plain" });
                response.end(error instanceof Error ? error.message : String(error));
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
                response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
            }
            return;
        }

        response.writeHead(404, { "Content-Type": "text/plain" });
        response.end("Not found");
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
