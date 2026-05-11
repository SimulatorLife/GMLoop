import { fileURLToPath } from "node:url";

const DEFAULT_API_PROXY_TARGET = "http://127.0.0.1:4173";
const DEFAULT_DEV_SERVER_HOST = "127.0.0.1";
const DEFAULT_DEV_SERVER_PORT = 4174;
const DEFAULT_PREVIEW_SERVER_PORT = 4175;

const resolveUiPath = (relativePath: string): string => fileURLToPath(new URL(relativePath, import.meta.url));

const resolvePort = (input: string | undefined, fallbackPort: number): number => {
    const parsedPort = Number.parseInt(input ?? "");
    if (Number.isNaN(parsedPort)) {
        return fallbackPort;
    }

    return parsedPort;
};

const resolveUiViteConfiguration = () => {
    const apiProxyTarget = process.env.GMLOOP_UI_API_PROXY_TARGET ?? DEFAULT_API_PROXY_TARGET;
    const devServerHost = process.env.GMLOOP_UI_DEV_HOST ?? DEFAULT_DEV_SERVER_HOST;
    const devServerPort = resolvePort(process.env.GMLOOP_UI_DEV_PORT, DEFAULT_DEV_SERVER_PORT);
    const previewServerPort = resolvePort(process.env.GMLOOP_UI_PREVIEW_PORT, DEFAULT_PREVIEW_SERVER_PORT);

    return {
        root: resolveUiPath("./src/web"),
        base: "./",
        esbuild: {
            target: "es2022"
        },
        server: {
            host: devServerHost,
            port: devServerPort,
            strictPort: true,
            hmr: true,
            proxy: {
                "/api": {
                    target: apiProxyTarget,
                    changeOrigin: true
                }
            }
        },
        preview: {
            host: devServerHost,
            port: previewServerPort,
            strictPort: true
        },
        build: {
            target: "es2022",
            emptyOutDir: true,
            manifest: true,
            outDir: resolveUiPath("./dist/web"),
            rollupOptions: {
                input: resolveUiPath("./src/web/index.html")
            },
            sourcemap: true
        }
    };
};

export default resolveUiViteConfiguration();
