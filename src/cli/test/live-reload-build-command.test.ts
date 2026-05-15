import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runCliTestCommand } from "../src/cli.js";
import {
    buildGameMakerHtml5Output,
    type GameMakerHtml5BuildConfig,
    resolveLiveReloadProjectBuildSettings
} from "../src/modules/live-reload/game-maker-build.js";
import { startLiveReloadDevSession } from "../src/modules/live-reload/session.js";

type GameMakerBuildConfigOverrides = Readonly<{
    backend?: GameMakerHtml5BuildConfig["backend"];
    cacheDir?: GameMakerHtml5BuildConfig["cacheDir"];
    configuration?: GameMakerHtml5BuildConfig["configuration"];
    extraArgs?: GameMakerHtml5BuildConfig["extraArgs"];
    licenseFile?: GameMakerHtml5BuildConfig["licenseFile"];
    outputRoot?: GameMakerHtml5BuildConfig["outputRoot"];
    projectPath?: GameMakerHtml5BuildConfig["projectPath"];
    runtimeRoot?: GameMakerHtml5BuildConfig["runtimeRoot"];
    tempDir?: GameMakerHtml5BuildConfig["tempDir"];
    toolPath?: GameMakerHtml5BuildConfig["toolPath"];
    userFolder?: GameMakerHtml5BuildConfig["userFolder"];
}>;

function createGameMakerBuildConfig(overrides: GameMakerBuildConfigOverrides = {}): GameMakerHtml5BuildConfig {
    return Object.freeze({
        backend: "auto",
        cacheDir: null,
        configuration: "Default",
        extraArgs: Object.freeze([]),
        licenseFile: null,
        outputRoot: "/tmp/project/build/html5",
        projectPath: "/tmp/project/Project.yyp",
        runtimeRoot: null,
        tempDir: null,
        toolPath: null,
        userFolder: null,
        ...overrides
    });
}

async function createTempDirectory(prefix: string): Promise<string> {
    return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function restoreProcessEnvironmentValue(name: "APPDATA" | "HOME" | "USERPROFILE", value: string | undefined): void {
    if (value === undefined) {
        delete process.env[name];
        return;
    }

    process.env[name] = value;
}

void test("live-reload build command help documents the dedicated HTML5 build entrypoint", async () => {
    const { stdout } = await runCliTestCommand({ argv: ["live-reload", "build", "--help"] });

    assert.match(stdout, /Build the configured GameMaker project to the HTML5 output used by live reload/u);
    assert.match(stdout, /\[targetPath\]/u);
});

void test("resolveLiveReloadProjectBuildSettings normalizes live-reload build config relative to the project root", async () => {
    const projectRoot = await createTempDirectory("cli-live-reload-config-");

    try {
        await fs.writeFile(path.join(projectRoot, "Project.yyp"), JSON.stringify({ name: "Project" }), "utf8");

        const settings = await resolveLiveReloadProjectBuildSettings(projectRoot, {
            runtime: {
                liveReload: {
                    build: {
                        backend: "igor",
                        cacheDir: ".gm-cache",
                        licenseFile: "license.plist",
                        runtimeRoot: "runtime"
                    },
                    gmTempRoot: ".gm-temp/html5",
                    html5Output: "build/html5"
                }
            }
        });

        assert.equal(settings.gmTempRoot, path.resolve(projectRoot, ".gm-temp/html5"));
        assert.equal(settings.html5OutputRoot, path.resolve(projectRoot, "build/html5"));
        assert.ok(settings.buildConfig);
        assert.equal(settings.buildConfig.backend, "igor");
        assert.equal(settings.buildConfig.projectPath, path.join(projectRoot, "Project.yyp"));
        assert.equal(settings.buildConfig.cacheDir, path.resolve(projectRoot, ".gm-cache"));
        assert.equal(settings.buildConfig.licenseFile, path.resolve(projectRoot, "license.plist"));
        assert.equal(settings.buildConfig.runtimeRoot, path.resolve(projectRoot, "runtime"));
    } finally {
        await fs.rm(projectRoot, { force: true, recursive: true });
    }
});

void test("resolveLiveReloadProjectBuildSettings requires html5Output when build config is enabled", async () => {
    const projectRoot = await createTempDirectory("cli-live-reload-config-missing-output-");

    try {
        await fs.writeFile(path.join(projectRoot, "Project.yyp"), JSON.stringify({ name: "Project" }), "utf8");

        await assert.rejects(
            () =>
                resolveLiveReloadProjectBuildSettings(projectRoot, {
                    runtime: {
                        liveReload: {
                            build: {
                                backend: "igor"
                            }
                        }
                    }
                }),
            /runtime\.liveReload\.html5Output/u
        );
    } finally {
        await fs.rm(projectRoot, { force: true, recursive: true });
    }
});

void test("buildGameMakerHtml5Output falls back from gm-cli to Igor when HTML5 packaging is unsupported", async () => {
    const projectRoot = await createTempDirectory("cli-live-reload-build-auto-");
    const outputRoot = path.join(projectRoot, "build", "html5");
    const runtimeRoot = path.join(projectRoot, "runtime-2026.1");
    const runtimeIgorPath = path.join(runtimeRoot, "bin", "igor", "osx", "x64", "Igor.exe");
    const licenseFile = path.join(projectRoot, "license.plist");
    const projectPath = path.join(projectRoot, "Project.yyp");

    try {
        await fs.mkdir(path.dirname(runtimeIgorPath), { recursive: true });
        await fs.writeFile(runtimeIgorPath, "", "utf8");
        await fs.writeFile(licenseFile, "license", "utf8");
        await fs.writeFile(projectPath, JSON.stringify({ name: "Project" }), "utf8");

        const executedCommands: Array<string> = [];
        const result = await buildGameMakerHtml5Output({
            buildConfig: createGameMakerBuildConfig({
                backend: "auto",
                licenseFile,
                outputRoot,
                projectPath,
                runtimeRoot
            }),
            cwd: projectRoot,
            executeProcess: async (command) => {
                executedCommands.push(command);
                if (command === "gm-cli") {
                    return Object.freeze({
                        exitCode: 1,
                        stderr: "",
                        stdout: "Support for target 'html5' is coming soon to GameMaker CLI."
                    });
                }

                await fs.mkdir(outputRoot, { recursive: true });
                await fs.writeFile(path.join(outputRoot, "index.html"), "<html></html>", "utf8");
                return Object.freeze({
                    exitCode: 0,
                    stderr: "",
                    stdout: "igor ok"
                });
            }
        });

        assert.equal(result.backend, "igor");
        assert.equal(executedCommands[0], "gm-cli");
        assert.equal(executedCommands.length, 2);
        assert.notEqual(executedCommands[1], "gm-cli");
    } finally {
        await fs.rm(projectRoot, { force: true, recursive: true });
    }
});

void test("buildGameMakerHtml5Output prefers gm-cli in auto mode when HTML5 packaging succeeds", async () => {
    const projectRoot = await createTempDirectory("cli-live-reload-build-gm-cli-");
    const outputRoot = path.join(projectRoot, "build", "html5");
    const projectPath = path.join(projectRoot, "Project.yyp");

    try {
        await fs.writeFile(projectPath, JSON.stringify({ name: "Project" }), "utf8");

        const executedCommands: Array<string> = [];
        const result = await buildGameMakerHtml5Output({
            buildConfig: createGameMakerBuildConfig({
                backend: "auto",
                outputRoot,
                projectPath
            }),
            cwd: projectRoot,
            executeProcess: async (command) => {
                executedCommands.push(command);
                await fs.mkdir(outputRoot, { recursive: true });
                await fs.writeFile(path.join(outputRoot, "index.html"), "<html></html>", "utf8");
                return Object.freeze({
                    exitCode: 0,
                    stderr: "",
                    stdout: "gm-cli ok"
                });
            }
        });

        assert.equal(result.backend, "gm-cli");
        assert.deepEqual(executedCommands, ["gm-cli"]);
    } finally {
        await fs.rm(projectRoot, { force: true, recursive: true });
    }
});

void test("buildGameMakerHtml5Output fails when the selected backend does not produce index.html", async () => {
    const projectRoot = await createTempDirectory("cli-live-reload-build-missing-index-");
    const outputRoot = path.join(projectRoot, "build", "html5");
    const runtimeRoot = path.join(projectRoot, "runtime-2026.1");
    const runtimeIgorPath = path.join(runtimeRoot, "bin", "igor", "osx", "x64", "Igor.exe");
    const licenseFile = path.join(projectRoot, "license.plist");
    const projectPath = path.join(projectRoot, "Project.yyp");

    try {
        await fs.mkdir(path.dirname(runtimeIgorPath), { recursive: true });
        await fs.writeFile(runtimeIgorPath, "", "utf8");
        await fs.writeFile(licenseFile, "license", "utf8");
        await fs.writeFile(projectPath, JSON.stringify({ name: "Project" }), "utf8");

        await assert.rejects(
            () =>
                buildGameMakerHtml5Output({
                    buildConfig: createGameMakerBuildConfig({
                        backend: "igor",
                        licenseFile,
                        outputRoot,
                        projectPath,
                        runtimeRoot
                    }),
                    cwd: projectRoot,
                    executeProcess: async () =>
                        Object.freeze({
                            exitCode: 0,
                            stderr: "",
                            stdout: "ok"
                        })
                }),
            /without producing/u
        );
    } finally {
        await fs.rm(projectRoot, { force: true, recursive: true });
    }
});

void test("buildGameMakerHtml5Output reports missing Igor identity prerequisites before spawning Igor", async () => {
    const projectRoot = await createTempDirectory("cli-live-reload-build-igor-prereqs-");
    const outputRoot = path.join(projectRoot, "build", "html5");
    const runtimeRoot = path.join(projectRoot, "runtime-2026.1");
    const runtimeIgorPath = path.join(runtimeRoot, "bin", "igor", "osx", "x64", "Igor.exe");
    const projectPath = path.join(projectRoot, "Project.yyp");
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const previousAppData = process.env.APPDATA;

    try {
        process.env.HOME = projectRoot;
        process.env.USERPROFILE = projectRoot;
        process.env.APPDATA = projectRoot;
        await fs.mkdir(path.dirname(runtimeIgorPath), { recursive: true });
        await fs.writeFile(runtimeIgorPath, "", "utf8");
        await fs.writeFile(projectPath, JSON.stringify({ name: "Project" }), "utf8");

        await assert.rejects(
            () =>
                buildGameMakerHtml5Output({
                    buildConfig: createGameMakerBuildConfig({
                        backend: "igor",
                        outputRoot,
                        projectPath,
                        runtimeRoot
                    }),
                    cwd: projectRoot,
                    executeProcess: async () => {
                        throw new Error("Igor should not spawn when prerequisites are missing.");
                    }
                }),
            /license or user folder/u
        );
    } finally {
        restoreProcessEnvironmentValue("HOME", previousHome);
        restoreProcessEnvironmentValue("USERPROFILE", previousUserProfile);
        restoreProcessEnvironmentValue("APPDATA", previousAppData);
        await fs.rm(projectRoot, { force: true, recursive: true });
    }
});

void test("startLiveReloadDevSession builds before preparing live reload when build config is present", async () => {
    const prepareCalls: Array<Readonly<{ gmTempRoot?: string; html5OutputRoot?: string | null }>> = [];
    const watchTargets: Array<string> = [];
    const buildCalls: Array<GameMakerHtml5BuildConfig> = [];
    const outputRoot = "/tmp/project/build/html5";
    const buildConfig = createGameMakerBuildConfig({
        backend: "igor",
        licenseFile: "/tmp/project/license.plist",
        outputRoot,
        projectPath: "/tmp/project/Project.yyp",
        runtimeRoot: "/tmp/project/runtime-2026.1"
    });

    await startLiveReloadDevSession({
        targetPath: "/tmp/project",
        bootstrapConfig: {
            websocketUrl: "ws://127.0.0.1:17890"
        },
        buildRunner: async ({ buildConfig: resolvedBuildConfig }) => {
            buildCalls.push(resolvedBuildConfig);
            return Object.freeze({
                backend: "igor",
                command: "igor",
                outputRoot,
                stderr: "",
                stdout: ""
            });
        },
        prepareRunner: async (options) => {
            prepareCalls.push({
                gmTempRoot: options.gmTempRoot,
                html5OutputRoot: options.html5OutputRoot
            });
            return Object.freeze({
                assets: {
                    bootstrapEntryPath: path.join(
                        outputRoot,
                        ".gml-hot-reload",
                        "runtime-wrapper",
                        "browser",
                        "index.js"
                    ),
                    copiedAssets: true,
                    manifestPath: path.join(outputRoot, ".gml-hot-reload", "runtime-wrapper-assets.manifest.json"),
                    targetRoot: path.join(outputRoot, ".gml-hot-reload")
                },
                injected: true,
                target: {
                    indexHtmlPath: path.join(outputRoot, "index.html"),
                    outputRoot
                }
            });
        },
        projectContextResolver: async () =>
            Object.freeze({
                projectConfig: {},
                projectRoot: "/tmp/project"
            }),
        settingsResolver: async () =>
            Object.freeze({
                buildConfig,
                gmTempRoot: path.resolve("/tmp/project", ".gm-temp/html5"),
                html5OutputRoot: outputRoot
            }),
        watchRunner: async (watchTarget) => {
            watchTargets.push(watchTarget);
        }
    });

    assert.equal(buildCalls.length, 1);
    assert.equal(buildCalls[0].outputRoot, outputRoot);
    assert.deepEqual(prepareCalls, [
        {
            gmTempRoot: path.resolve("/tmp/project", ".gm-temp/html5"),
            html5OutputRoot: outputRoot
        }
    ]);
    assert.deepEqual(watchTargets, ["/tmp/project"]);
});

void test("startLiveReloadDevSession uses configured temp-root fallback when no build config exists", async () => {
    const prepareCalls: Array<string | undefined> = [];

    await startLiveReloadDevSession({
        targetPath: "/tmp/project",
        bootstrapConfig: {
            websocketUrl: "ws://127.0.0.1:17890"
        },
        prepareRunner: async (options) => {
            prepareCalls.push(options.gmTempRoot);
            return Object.freeze({
                assets: {
                    bootstrapEntryPath: "/tmp/project/output/.gml-hot-reload/runtime-wrapper/browser/index.js",
                    copiedAssets: true,
                    manifestPath: "/tmp/project/output/.gml-hot-reload/runtime-wrapper-assets.manifest.json",
                    targetRoot: "/tmp/project/output/.gml-hot-reload"
                },
                injected: true,
                target: {
                    indexHtmlPath: "/tmp/project/output/index.html",
                    outputRoot: "/tmp/project/output"
                }
            });
        },
        projectContextResolver: async () =>
            Object.freeze({
                projectConfig: {},
                projectRoot: "/tmp/project"
            }),
        settingsResolver: async () =>
            Object.freeze({
                buildConfig: null,
                gmTempRoot: "/tmp/project/.gm-temp/html5",
                html5OutputRoot: null
            }),
        watchRunner: async () => {}
    });

    assert.deepEqual(prepareCalls, ["/tmp/project/.gm-temp/html5"]);
});
