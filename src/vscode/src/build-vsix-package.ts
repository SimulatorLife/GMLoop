import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type PackageManifest = {
    readonly activationEvents: readonly string[];
    readonly categories: readonly string[];
    readonly contributes: Record<string, object>;
    readonly dependencies: Record<string, string>;
    readonly description: string;
    readonly displayName: string;
    readonly engines: Record<string, string>;
    readonly main: string;
    readonly version: string;
};

const VSCODE_EXTENSION_NAME = "gmloop";
const VSCODE_EXTENSION_PUBLISHER = "gmloop";
const VSCODE_EXTENSION_FILES = [
    "dist/src/extension.js",
    "dist/src/extension.js.map",
    "dist/src/server-command.js",
    "dist/src/server-command.js.map",
    "language-configuration.json",
    "node_modules/**",
    "README.md"
] as const;

function readPackageManifest(packageRoot: string): PackageManifest {
    const manifestPath = path.join(packageRoot, "package.json");
    return JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
}

function createVSCodePackageManifest(
    workspaceManifest: PackageManifest
): Record<string, object | string | readonly string[]> {
    return {
        activationEvents: workspaceManifest.activationEvents,
        categories: workspaceManifest.categories,
        contributes: workspaceManifest.contributes,
        dependencies: workspaceManifest.dependencies,
        description: workspaceManifest.description,
        displayName: workspaceManifest.displayName,
        engines: workspaceManifest.engines,
        files: VSCODE_EXTENSION_FILES,
        main: workspaceManifest.main,
        name: VSCODE_EXTENSION_NAME,
        publisher: VSCODE_EXTENSION_PUBLISHER,
        version: workspaceManifest.version
    };
}

function copyRequiredExtensionFiles(packageRoot: string, stageRoot: string): void {
    const stageDistSourceRoot = path.join(stageRoot, "dist", "src");
    mkdirSync(stageDistSourceRoot, { recursive: true });

    for (const fileName of ["extension.js", "extension.js.map", "server-command.js", "server-command.js.map"]) {
        cpSync(path.join(packageRoot, "dist", "src", fileName), path.join(stageDistSourceRoot, fileName));
    }

    cpSync(path.join(packageRoot, "language-configuration.json"), path.join(stageRoot, "language-configuration.json"));
    cpSync(path.join(packageRoot, "README.md"), path.join(stageRoot, "README.md"));
}

function runCommand(command: string, args: readonly string[], cwd: string): void {
    const result = spawnSync(command, [...args], {
        cwd,
        env: {
            ...process.env,
            CI: "true"
        },
        stdio: "inherit"
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(`Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`);
    }
}

function resolveVSCECommandPath(packageRoot: string): string {
    const binaryName = process.platform === "win32" ? "vsce.cmd" : "vsce";
    return path.join(packageRoot, "node_modules", ".bin", binaryName);
}

function createVSIXPackage(): void {
    const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const workspaceManifest = readPackageManifest(packageRoot);
    const stageRoot = path.join(tmpdir(), "gmloop-vscode-vsix-stage");
    const outputPath = path.join(packageRoot, "dist", `${VSCODE_EXTENSION_NAME}-${workspaceManifest.version}.vsix`);

    if (existsSync(stageRoot)) {
        rmSync(stageRoot, { force: true, recursive: true });
    }

    mkdirSync(stageRoot, { recursive: true });
    copyRequiredExtensionFiles(packageRoot, stageRoot);
    writeFileSync(
        path.join(stageRoot, "package.json"),
        `${JSON.stringify(createVSCodePackageManifest(workspaceManifest), null, 2)}\n`
    );

    runCommand("npm", ["install", "--omit=dev", "--ignore-scripts"], stageRoot);
    runCommand(
        resolveVSCECommandPath(packageRoot),
        ["package", "--allow-missing-repository", "--skip-license", "--out", outputPath],
        stageRoot
    );
}

createVSIXPackage();
