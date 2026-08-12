import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

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

type RuntimePackageManifest = {
    readonly dependencies: Readonly<Record<string, string>>;
    readonly name: string;
    readonly peerDependencies: Readonly<Record<string, string>> | undefined;
    readonly version: string;
};

const VSCODE_EXTENSION_NAME = "gmloop";
const VSCODE_EXTENSION_PUBLISHER = "gmloop";
const PACKAGE_MANIFEST_FILE_NAME = "package.json";
const BUNDLED_SERVER_WORKSPACES = ["core", "parser", "format", "lint", "refactor", "semantic"] as const;
const EXTENSION_LAUNCHER_FILES = [
    "extension.js",
    "extension.js.map",
    "server-command.js",
    "server-command.js.map",
    "sync.js",
    "sync.js.map"
] as const;
const VSCODE_EXTENSION_FILES = [
    ...EXTENSION_LAUNCHER_FILES.map((fileName) => `dist/src/${fileName}`),
    "server/**",
    "language-configuration.json",
    "syntaxes/gml.tmLanguage.json",
    "syntaxes/markdown-gml.tmLanguage.json",
    "node_modules/**",
    "README.md"
] as const;

function readPackageManifest(packageRoot: string): PackageManifest {
    const manifestPath = path.join(packageRoot, PACKAGE_MANIFEST_FILE_NAME);
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

    for (const fileName of EXTENSION_LAUNCHER_FILES) {
        cpSync(path.join(packageRoot, "dist", "src", fileName), path.join(stageDistSourceRoot, fileName));
    }

    cpSync(path.join(packageRoot, "language-configuration.json"), path.join(stageRoot, "language-configuration.json"));
    const stageSyntaxRoot = path.join(stageRoot, "syntaxes");
    mkdirSync(stageSyntaxRoot, { recursive: true });
    cpSync(
        path.join(packageRoot, "syntaxes", "gml.tmLanguage.json"),
        path.join(stageSyntaxRoot, "gml.tmLanguage.json")
    );
    cpSync(
        path.join(packageRoot, "syntaxes", "markdown-gml.tmLanguage.json"),
        path.join(stageSyntaxRoot, "markdown-gml.tmLanguage.json")
    );
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

function readRuntimePackageManifest(packageRoot: string): RuntimePackageManifest {
    return JSON.parse(
        readFileSync(path.join(packageRoot, PACKAGE_MANIFEST_FILE_NAME), "utf8")
    ) as RuntimePackageManifest;
}

function readCatalogVersions(repositoryRoot: string): Readonly<Record<string, string>> {
    const workspaceConfiguration: unknown = parse(
        readFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8")
    );
    if (workspaceConfiguration === null || typeof workspaceConfiguration !== "object") {
        throw new Error("pnpm-workspace.yaml must contain a catalog mapping");
    }

    const catalog = (workspaceConfiguration as Readonly<Record<string, unknown>>).catalog;
    if (catalog === null || typeof catalog !== "object") {
        throw new Error("pnpm-workspace.yaml must contain a catalog mapping");
    }

    const catalogVersions: Record<string, string> = {};
    for (const [packageName, packageVersion] of Object.entries(catalog)) {
        if (typeof packageVersion !== "string") {
            throw new TypeError(`Catalog version must be a string: ${packageName}`);
        }
        catalogVersions[packageName] = packageVersion;
    }
    return catalogVersions;
}

function rewriteWorkspaceDependencies(
    dependencies: Readonly<Record<string, string>>,
    catalogVersions: Readonly<Record<string, string>>,
    workspaceVersions: ReadonlyMap<string, string>
): Record<string, string> {
    const rewrittenDependencies: Record<string, string> = {};
    for (const [packageName, dependencyVersion] of Object.entries(dependencies)) {
        if (dependencyVersion === "catalog:") {
            const catalogVersion = catalogVersions[packageName];
            if (catalogVersion === undefined) {
                throw new Error(`Bundled server catalog dependency is not defined at the root: ${packageName}`);
            }
            rewrittenDependencies[packageName] = catalogVersion;
            continue;
        }
        if (!dependencyVersion.startsWith("workspace:")) {
            rewrittenDependencies[packageName] = dependencyVersion;
            continue;
        }

        const workspaceVersion = workspaceVersions.get(packageName);
        if (workspaceVersion === undefined) {
            throw new Error(`Bundled server dependency is not staged: ${packageName}`);
        }
        rewrittenDependencies[packageName] = workspaceVersion;
    }
    return rewrittenDependencies;
}

function rewriteOptionalWorkspaceDependencies(
    dependencies: Readonly<Record<string, string>> | undefined,
    catalogVersions: Readonly<Record<string, string>>,
    workspaceVersions: ReadonlyMap<string, string>
): Record<string, string> | undefined {
    return dependencies === undefined
        ? undefined
        : rewriteWorkspaceDependencies(dependencies, catalogVersions, workspaceVersions);
}

function createBundledWorkspaceTarball(
    workspaceRoot: string,
    packageBuildRoot: string,
    tarballRoot: string,
    catalogVersions: Readonly<Record<string, string>>,
    workspaceVersions: ReadonlyMap<string, string>
): string {
    const manifest = readRuntimePackageManifest(workspaceRoot);
    const packageSourceRoot = path.join(packageBuildRoot, manifest.name.replace("@gmloop/", ""));
    mkdirSync(packageSourceRoot, { recursive: true });
    cpSync(path.join(workspaceRoot, "dist"), path.join(packageSourceRoot, "dist"), { recursive: true });
    const readmePath = path.join(workspaceRoot, "README.md");
    if (existsSync(readmePath)) {
        cpSync(readmePath, path.join(packageSourceRoot, "README.md"));
    }
    writeFileSync(
        path.join(packageSourceRoot, PACKAGE_MANIFEST_FILE_NAME),
        `${JSON.stringify(
            {
                ...manifest,
                devDependencies: undefined,
                dependencies: rewriteWorkspaceDependencies(manifest.dependencies, catalogVersions, workspaceVersions),
                peerDependencies: rewriteOptionalWorkspaceDependencies(
                    manifest.peerDependencies,
                    catalogVersions,
                    workspaceVersions
                )
            },
            null,
            2
        )}\n`
    );

    runCommand(
        "npm",
        ["pack", packageSourceRoot, "--pack-destination", tarballRoot, "--ignore-scripts", "--silent"],
        packageBuildRoot
    );
    return path.join(tarballRoot, `${manifest.name.slice(1).replace("/", "-")}-${manifest.version}.tgz`);
}

function packageBundledLanguageServer(packageRoot: string, stageRoot: string): void {
    const repositoryRoot = path.resolve(packageRoot, "..", "..");
    const serverRoot = path.join(stageRoot, "server");
    const packageBuildRoot = path.join(stageRoot, ".server-package-build");
    const tarballRoot = path.join(packageBuildRoot, "tarballs");

    runCommand(
        "pnpm",
        ["--config.verify-deps-before-run=false", "--filter", "@gmloop/lsp...", "run", "build:types"],
        repositoryRoot
    );
    mkdirSync(tarballRoot, { recursive: true });

    const lspWorkspaceRoot = path.join(repositoryRoot, "src", "lsp");
    const catalogVersions = readCatalogVersions(repositoryRoot);
    const bundledWorkspaceRoots = BUNDLED_SERVER_WORKSPACES.map((workspaceName) =>
        path.join(repositoryRoot, "src", workspaceName)
    );
    const bundledManifests = bundledWorkspaceRoots.map((workspaceRoot) => readRuntimePackageManifest(workspaceRoot));
    const workspaceVersions = new Map(bundledManifests.map((manifest) => [manifest.name, manifest.version] as const));
    const tarballPaths = new Map<string, string>();
    for (const workspaceRoot of bundledWorkspaceRoots) {
        const manifest = readRuntimePackageManifest(workspaceRoot);
        tarballPaths.set(
            manifest.name,
            createBundledWorkspaceTarball(
                workspaceRoot,
                packageBuildRoot,
                tarballRoot,
                catalogVersions,
                workspaceVersions
            )
        );
    }

    const lspManifest = readRuntimePackageManifest(lspWorkspaceRoot);
    const serverDependencies = rewriteWorkspaceDependencies(
        lspManifest.dependencies,
        catalogVersions,
        workspaceVersions
    );
    for (const [packageName, tarballPath] of tarballPaths) {
        serverDependencies[packageName] = `file:${tarballPath}`;
    }

    mkdirSync(serverRoot, { recursive: true });
    cpSync(path.join(lspWorkspaceRoot, "dist"), path.join(serverRoot, "dist"), { recursive: true });
    cpSync(path.join(lspWorkspaceRoot, "README.md"), path.join(serverRoot, "README.md"));
    writeFileSync(
        path.join(serverRoot, PACKAGE_MANIFEST_FILE_NAME),
        `${JSON.stringify(
            {
                ...lspManifest,
                devDependencies: undefined,
                dependencies: serverDependencies,
                peerDependencies: rewriteOptionalWorkspaceDependencies(
                    lspManifest.peerDependencies,
                    catalogVersions,
                    workspaceVersions
                )
            },
            null,
            2
        )}\n`
    );
    runCommand("npm", ["install", "--omit=dev", "--ignore-scripts"], serverRoot);

    writeFileSync(
        path.join(serverRoot, PACKAGE_MANIFEST_FILE_NAME),
        `${JSON.stringify(
            {
                ...lspManifest,
                devDependencies: undefined,
                dependencies: rewriteWorkspaceDependencies(
                    lspManifest.dependencies,
                    catalogVersions,
                    workspaceVersions
                ),
                peerDependencies: rewriteOptionalWorkspaceDependencies(
                    lspManifest.peerDependencies,
                    catalogVersions,
                    workspaceVersions
                )
            },
            null,
            2
        )}\n`
    );
    rmSync(path.join(serverRoot, "package-lock.json"), { force: true });
    rmSync(path.join(serverRoot, "node_modules", ".bin"), { force: true, recursive: true });
    rmSync(packageBuildRoot, { force: true, recursive: true });
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
    packageBundledLanguageServer(packageRoot, stageRoot);
    writeFileSync(
        path.join(stageRoot, PACKAGE_MANIFEST_FILE_NAME),
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
