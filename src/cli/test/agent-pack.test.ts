import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as AgentPack from "../src/modules/auto-game-agent-pack/index.js";
import { __agentPackTest__ } from "../src/modules/auto-game-agent-pack/project-agent-pack.js";

type AgentPackReceiptFixture = Readonly<{
    conflicts: ReadonlyArray<string>;
    files: Readonly<Record<string, string>>;
    package: string;
    version: string;
}>;

async function createGameProjectFixture(): Promise<Readonly<{ cleanup: () => Promise<void>; projectRoot: string }>> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-agent-pack-"));
    await writeFile(path.join(projectRoot, "Fixture.yyp"), '{"resourceType":"GMProject"}\n', "utf8");
    return Object.freeze({
        cleanup: () => rm(projectRoot, { force: true, recursive: true }),
        projectRoot
    });
}

async function readReceipt(projectRoot: string): Promise<AgentPackReceiptFixture> {
    return JSON.parse(
        await readFile(path.join(projectRoot, ".gmloop", "agent-pack.json"), "utf8")
    ) as AgentPackReceiptFixture;
}

function hashText(source: string): string {
    return createHash("sha256").update(source).digest("hex");
}

void test("agent pack discovery treats shared skill symlinks as packaged skill directories", async () => {
    const sharedSkillNames = ["gmloop-gml-syntax-basics"];
    const symlinkStats = await Promise.all(
        sharedSkillNames.map((name) => lstat(path.join("src", "agent-pack", "skills", name)))
    );
    assert.equal(
        symlinkStats.every((stats) => stats.isSymbolicLink()),
        true
    );

    const names = await AgentPack.discoverPackagedSkillNames();
    for (const sharedSkillName of sharedSkillNames) {
        assert.ok(names.includes(sharedSkillName));
        const source = await readFile(path.join("src", "agent-pack", "skills", sharedSkillName, "SKILL.md"), "utf8");
        assert.match(source, new RegExp(String.raw`^---\n[\s\S]*?^name: ${sharedSkillName}$`, "mu"));
    }
});

void test("agent pack exposes a deterministic raw skill collection", async () => {
    const names = await AgentPack.discoverPackagedSkillNames();
    assert.ok(names.length > 0);
    assert.deepEqual(names, [...names].sort());
    assert.equal(new Set(names).size, names.length);
    assert.equal(
        names.every((name) => name.startsWith("gmloop-")),
        true
    );
    assert.ok(names.includes("gmloop-doubt-driven-development"));
    assert.ok(names.includes("gmloop-gml-syntax-basics"));
});

void test("agent pack skill sources declare frontmatter names matching their packaged directories", async () => {
    const names = await AgentPack.discoverPackagedSkillNames();
    for (const name of names) {
        const source = await readFile(path.join("src", "agent-pack", "skills", name, "SKILL.md"), "utf8");
        assert.match(source, new RegExp(String.raw`^---\n[\s\S]*?^name: ${name}$`, "mu"));
    }
});

void test("agent pack exposes every packaged template and skill for read-only preview", async () => {
    const [resources, skillNames] = await Promise.all([
        AgentPack.readAgentPackResourcePreviews(),
        AgentPack.discoverPackagedSkillNames()
    ]);

    assert.deepEqual(
        resources.slice(0, 5).map((resource) => resource.targetPath),
        ["AGENTS.md", ".lsp-mcp.json", ".vscode/settings.json", ".vscode/extensions.json", ".gitignore"]
    );
    assert.deepEqual(
        resources.filter((resource) => resource.kind === "skill").map((resource) => resource.targetPath),
        skillNames.map((name) => `.agents/skills/${name}/SKILL.md`)
    );
    assert.equal(
        resources.every((resource) => resource.content.length > 0),
        true
    );
    assert.equal(resources[0]?.packagePath, "templates/project-agents.md");
    assert.match(resources[0]?.content ?? "", /# Autonomous Game Development Guidance/u);
    assert.equal(resources[1]?.packagePath, "templates/project-lsp-mcp.json");
    assert.match(resources[1]?.content ?? "", /gmloop/u);
    assert.equal(resources[2]?.packagePath, "templates/project-vscode-settings.json");
    assert.match(resources[2]?.content ?? "", /gmloop\.serverPath/u);
    assert.equal(resources[3]?.packagePath, "templates/project-vscode-extensions.json");
    assert.match(resources[3]?.content ?? "", /gmloop\.gmloop/u);
    assert.equal(resources[4]?.packagePath, "templates/project-gitignore");
    assert.match(resources[4]?.content ?? "", /\.gmloop\//u);
});

void test("agent integration discovery classifies Qwen CLI setup and manual provider configs", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await mkdir(path.join(fixture.projectRoot, ".qwen"), { recursive: true });
        await mkdir(path.join(fixture.projectRoot, ".codex"), { recursive: true });
        await writeFile(path.join(fixture.projectRoot, ".qwen", "settings.json"), "{}\n", "utf8");
        await writeFile(path.join(fixture.projectRoot, ".codex", "config.toml"), "\n", "utf8");
        const commandRunner: AgentPack.AgentCliCommandRunner = async (command, args) => {
            if (args.length === 1 && args[0] === "--version") {
                if (command === "qwen") {
                    return { exitCode: 0, stderr: "", stdout: "qwen 1.2.3\n" };
                }
                if (command === "codex") {
                    return { exitCode: 0, stderr: "", stdout: "codex 0.42.0\n" };
                }
            }
            return { exitCode: -1, stderr: "", stdout: "" };
        };

        const targets = await AgentPack.discoverAgentIntegrationTargets(fixture.projectRoot, commandRunner);
        const qwen = targets.find((target) => target.id === "qwen");
        const codex = targets.find((target) => target.id === "codex");
        const gemini = targets.find((target) => target.id === "gemini");

        assert.equal(qwen?.status, "cli-configurable");
        assert.equal(qwen?.selectedByDefault, true);
        assert.equal(qwen?.cliVersion, "qwen 1.2.3");
        assert.deepEqual(qwen?.configPaths, [".qwen/settings.json"]);
        assert.equal(codex?.status, "manual-required");
        assert.equal(codex?.selectedByDefault, false);
        assert.deepEqual(codex?.configPaths, [".codex/config.toml"]);
        assert.equal(gemini?.status, "unavailable");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent integration setup configures only selected CLI-owned Qwen MCP servers", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await mkdir(path.join(fixture.projectRoot, ".qwen"), { recursive: true });
        await writeFile(path.join(fixture.projectRoot, ".qwen", "settings.json"), "{}\n", "utf8");
        const calls = new Array<Readonly<{ args: ReadonlyArray<string>; command: string; cwd: string }>>();
        const commandRunner: AgentPack.AgentCliCommandRunner = async (command, args, options) => {
            calls.push({ args, command, cwd: options.cwd });
            if (args.length === 1 && args[0] === "--version") {
                return command === "qwen"
                    ? { exitCode: 0, stderr: "", stdout: "qwen 1.2.3\n" }
                    : { exitCode: -1, stderr: "", stdout: "" };
            }
            return { exitCode: 0, stderr: "", stdout: "" };
        };

        const result = await AgentPack.configureSelectedAgentIntegrations(
            fixture.projectRoot,
            ["detected"],
            commandRunner
        );
        const setupCalls = calls.filter((call) => call.args[0] === "mcp");

        assert.deepEqual(result.setup.configured, ["qwen"]);
        assert.deepEqual(result.setup.failed, []);
        assert.deepEqual(
            setupCalls.map((call) => call.command),
            ["qwen", "qwen", "qwen", "qwen"]
        );
        assert.deepEqual(
            setupCalls.map((call) => call.args),
            [
                ["mcp", "add", "--scope", "project", "--trust", "gmloop", "gmloop", "mcp"],
                ["mcp", "add", "--scope", "project", "--trust", "lsp", "pnpm", "exec", "lsp-mcp-server"],
                [
                    "mcp",
                    "add",
                    "--scope",
                    "project",
                    "--trust",
                    "--exclude-tools",
                    "browser_run_code_unsafe",
                    "playwright",
                    "npx",
                    "-y",
                    "@playwright/mcp@latest"
                ],
                ["mcp", "add", "--scope", "project", "--trust", "gm-cli", "gmloop", "gm-cli", "mcp"]
            ]
        );
        assert.equal(
            setupCalls.every((call) => call.cwd === fixture.projectRoot),
            true
        );
    } finally {
        await fixture.cleanup();
    }
});

void test("agent target selection parser rejects ambiguous or unsupported selections", () => {
    assert.deepEqual(AgentPack.parseAgentConfigTargetSelections("qwen,codex"), ["qwen", "codex"]);
    assert.deepEqual(AgentPack.parseAgentConfigTargetSelections("detected"), ["detected"]);
    assert.throws(() => AgentPack.parseAgentConfigTargetSelections("detected,qwen"), /cannot be combined/u);
    assert.throws(() => AgentPack.parseAgentConfigTargetSelections("claude"), /must be one of/u);
});

void test("agent pack initialization installs skills, project guidance, and a version receipt", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const result = await AgentPack.initializeAgentPack(fixture.projectRoot);
        const names = await AgentPack.discoverPackagedSkillNames();
        assert.deepEqual(
            result.added.filter((relativePath) => relativePath.endsWith("/SKILL.md")),
            names.map((name) => `.agents/skills/${name}/SKILL.md`)
        );
        const installedSkillSources = await Promise.all(
            names.map((name) => readFile(path.join(fixture.projectRoot, ".agents", "skills", name, "SKILL.md"), "utf8"))
        );
        for (const [index, source] of installedSkillSources.entries()) {
            assert.match(source, new RegExp(String.raw`^---\n[\s\S]*?^name: ${names[index] ?? ""}$`, "mu"));
        }
        const toolingSkillSource = installedSkillSources[names.indexOf("gmloop-tooling")];
        assert.ok(toolingSkillSource);
        assert.match(toolingSkillSource, /MCP surface is generated from the current CLI command catalog/u);
        assert.match(toolingSkillSource, /gmloop help <command>/u);
        assert.match(toolingSkillSource, /lintRuleset/u);
        assert.match(toolingSkillSource, /refactor\.codemods/u);
        assert.match(toolingSkillSource, /syntax-recovery or recovery-capable codemod workflow/u);
        assert.match(toolingSkillSource, /semantic rename transaction/u);
        assert.doesNotMatch(toolingSkillSource, /gmloop_[a-z]/u);
        assert.ok(result.added.includes("AGENTS.md"));
        assert.ok(result.added.includes(".lsp-mcp.json"));
        assert.ok(result.added.includes(".gitignore"));
        assert.equal(
            await readFile(path.join(fixture.projectRoot, ".gitignore"), "utf8"),
            "# GMLoop generated files\n.gmloop/\n.gmcache/\nnode_modules/\n.playwright-mcp/\n.lsp-mcp.json\n.agents/skills/**/gmloop-*\ncache/\nrepomix-output.xml\n"
        );
        const lspMcpConfig = await readFile(path.join(fixture.projectRoot, ".lsp-mcp.json"), "utf8");
        assert.match(lspMcpConfig, /"id": "gml"/u);
        const projectGuidance = await readFile(path.join(fixture.projectRoot, "AGENTS.md"), "utf8");
        assert.match(projectGuidance, /# Autonomous Game Development Guidance/u);
        assert.match(projectGuidance, /## Autonomous Iteration Loop/u);
        assert.match(projectGuidance, /smallest player-visible improvement/u);
        assert.match(projectGuidance, /## Validation And Completion/u);
        assert.match(projectGuidance, /official `gm-cli` flow/u);
        assert.match(projectGuidance, /HTML5 target/u);
        assert.match(projectGuidance, /Playwright MCP integration/u);
        assert.match(projectGuidance, /Do not treat parsing, formatting, unit tests, compilation, launch/u);
        assert.match(projectGuidance, /## Failure And Escalation/u);
        assert.doesNotMatch(projectGuidance, /agent pack/iu);
        assert.doesNotMatch(projectGuidance, /permission layer/iu);

        const receipt = await readReceipt(fixture.projectRoot);
        assert.equal(receipt.package, "@gmloop/agent-pack");
        assert.equal(receipt.version, await AgentPack.readAgentPackVersion());
        assert.deepEqual(receipt.conflicts, []);
        const status = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(status.status, "current");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack initialization merges missing gitignore entries without replacing project rules", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const existingGitIgnore = "# Project rules\n/exports/\n**/.gmloop\nnode_modules\n";
        await writeFile(path.join(fixture.projectRoot, ".gitignore"), existingGitIgnore, "utf8");

        const result = await AgentPack.initializeAgentPack(fixture.projectRoot);
        const mergedGitIgnore = await readFile(path.join(fixture.projectRoot, ".gitignore"), "utf8");

        assert.ok(result.updated.includes(".gitignore"));
        assert.ok(mergedGitIgnore.startsWith(existingGitIgnore));
        assert.match(
            mergedGitIgnore,
            /# GMLoop generated files\n\.gmcache\/\n\.playwright-mcp\/\n\.lsp-mcp\.json\n\.agents\/skills\/\*\*\/gmloop-\*/u
        );
        assert.equal(Array.from(mergedGitIgnore.matchAll(/\.gmloop/gu)).length, 1);
        assert.equal(Array.from(mergedGitIgnore.matchAll(/node_modules/gu)).length, 1);

        const second = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.ok(second.unchanged.includes(".gitignore"));
        assert.equal(await readFile(path.join(fixture.projectRoot, ".gitignore"), "utf8"), mergedGitIgnore);
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack initialization leaves gitignore untouched when disabled", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const result = await AgentPack.initializeAgentPack(fixture.projectRoot, { includeGitIgnore: false });
        await assert.rejects(() => readFile(path.join(fixture.projectRoot, ".gitignore"), "utf8"), /ENOENT/u);
        assert.equal(result.added.includes(".gitignore"), false);
        assert.equal(result.updated.includes(".gitignore"), false);
        assert.equal(result.unchanged.includes(".gitignore"), false);
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack initialization sets up VSCode project files and installs extension when enabled", async () => {
    const fixture = await createGameProjectFixture();
    const calls = new Array<Readonly<{ args: ReadonlyArray<string>; command: string; cwd: string }>>();
    const commandRunner: AgentPack.AgentCliCommandRunner = async (command, args, options) => {
        calls.push({ args, command, cwd: options.cwd });
        if (command === "code") {
            return { exitCode: 0, stderr: "", stdout: "installed\n" };
        }
        return { exitCode: -1, stderr: "", stdout: "" };
    };

    try {
        const result = await AgentPack.initializeAgentPack(fixture.projectRoot, {
            agentTargets: ["none"],
            commandRunner,
            includeGitIgnore: false,
            includeVSCode: true
        });

        assert.ok(result.added.includes(".vscode/settings.json"));
        assert.ok(result.added.includes(".vscode/extensions.json"));
        assert.deepEqual(result.vscodeSetup, {
            enabled: true,
            extensionInstall: {
                detail: "Installed VSCode extension 'gmloop.gmloop'.",
                status: "installed"
            }
        });
        assert.deepEqual(
            calls.filter((call) => call.command === "code").map((call) => call.args),
            [["--install-extension", "gmloop.gmloop"]]
        );
        assert.equal(
            calls.filter((call) => call.command === "code").every((call) => call.cwd === fixture.projectRoot),
            true
        );
        assert.deepEqual(
            JSON.parse(await readFile(path.join(fixture.projectRoot, ".vscode", "settings.json"), "utf8")),
            { "gmloop.serverPath": "gmloop" }
        );
        assert.deepEqual(
            JSON.parse(await readFile(path.join(fixture.projectRoot, ".vscode", "extensions.json"), "utf8")),
            { recommendations: ["gmloop.gmloop"] }
        );
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack initialization merges VSCode project files without replacing project settings", async () => {
    const fixture = await createGameProjectFixture();
    const commandRunner: AgentPack.AgentCliCommandRunner = async () => ({ exitCode: -1, stderr: "", stdout: "" });

    try {
        await mkdir(path.join(fixture.projectRoot, ".vscode"), { recursive: true });
        await writeFile(
            path.join(fixture.projectRoot, ".vscode", "settings.json"),
            `${JSON.stringify({ "editor.tabSize": 4 }, null, 2)}\n`,
            "utf8"
        );
        await writeFile(
            path.join(fixture.projectRoot, ".vscode", "extensions.json"),
            `${JSON.stringify({ recommendations: ["example.existing"] }, null, 2)}\n`,
            "utf8"
        );

        const result = await AgentPack.initializeAgentPack(fixture.projectRoot, {
            agentTargets: ["none"],
            commandRunner,
            includeGitIgnore: false,
            includeVSCode: true
        });

        assert.ok(result.updated.includes(".vscode/settings.json"));
        assert.ok(result.updated.includes(".vscode/extensions.json"));
        assert.equal(result.vscodeSetup.extensionInstall.status, "failed");
        assert.deepEqual(
            JSON.parse(await readFile(path.join(fixture.projectRoot, ".vscode", "settings.json"), "utf8")),
            { "editor.tabSize": 4, "gmloop.serverPath": "gmloop" }
        );
        assert.deepEqual(
            JSON.parse(await readFile(path.join(fixture.projectRoot, ".vscode", "extensions.json"), "utf8")),
            { recommendations: ["example.existing", "gmloop.gmloop"] }
        );

        const second = await AgentPack.initializeAgentPack(fixture.projectRoot, {
            agentTargets: ["none"],
            commandRunner,
            includeGitIgnore: false,
            includeVSCode: true
        });
        assert.ok(second.unchanged.includes(".vscode/settings.json"));
        assert.ok(second.unchanged.includes(".vscode/extensions.json"));
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack initialization reports VSCode settings conflicts without overwriting invalid project files", async () => {
    const fixture = await createGameProjectFixture();
    const commandRunner: AgentPack.AgentCliCommandRunner = async () => ({ exitCode: -1, stderr: "", stdout: "" });

    try {
        await mkdir(path.join(fixture.projectRoot, ".vscode"), { recursive: true });
        await writeFile(path.join(fixture.projectRoot, ".vscode", "settings.json"), "{", "utf8");

        const result = await AgentPack.initializeAgentPack(fixture.projectRoot, {
            agentTargets: ["none"],
            commandRunner,
            includeGitIgnore: false,
            includeVSCode: true
        });

        assert.ok(result.conflicts.includes(".vscode/settings.json"));
        assert.equal(await readFile(path.join(fixture.projectRoot, ".vscode", "settings.json"), "utf8"), "{");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack initialization is idempotent and preserves project-owned files", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const projectGuidance = "# Project-owned instructions\n";
        await writeFile(path.join(fixture.projectRoot, "AGENTS.md"), projectGuidance, "utf8");
        const first = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.equal(first.changed, true);
        assert.deepEqual(first.conflicts, ["AGENTS.md"]);
        assert.equal(await readFile(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"), projectGuidance);

        const second = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.equal(second.changed, false);
        assert.deepEqual(second.added, []);
        assert.deepEqual(second.updated, []);
        assert.deepEqual(second.conflicts, ["AGENTS.md"]);
        assert.equal(await readFile(path.join(fixture.projectRoot, "AGENTS.md"), "utf8"), projectGuidance);
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack reports a change when initialization adds only the missing version receipt", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await AgentPack.initializeAgentPack(fixture.projectRoot);
        await rm(path.join(fixture.projectRoot, ".gmloop", "agent-pack.json"));

        const result = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.equal(result.changed, true);
        assert.deepEqual(result.added, []);
        assert.deepEqual(result.updated, []);
        const status = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(status.status, "current");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack update replaces only content matching the previously installed source", async () => {
    const fixture = await createGameProjectFixture();
    try {
        await AgentPack.initializeAgentPack(fixture.projectRoot);
        const receipt = await readReceipt(fixture.projectRoot);
        const managedPath = Object.keys(receipt.files).find((relativePath) => relativePath.endsWith("/SKILL.md"));
        assert.ok(managedPath);
        const simulatedOldSource = "previous packaged content\n";
        await writeFile(path.join(fixture.projectRoot, ...managedPath.split("/")), simulatedOldSource, "utf8");
        await writeFile(
            path.join(fixture.projectRoot, ".gmloop", "agent-pack.json"),
            `${JSON.stringify({ ...receipt, files: { ...receipt.files, [managedPath]: hashText(simulatedOldSource) }, version: "0.0.0" }, null, 2)}\n`,
            "utf8"
        );

        const beforeUpdate = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(beforeUpdate.status, "update-available");
        const update = await AgentPack.initializeAgentPack(fixture.projectRoot);
        assert.deepEqual(update.updated, [managedPath]);
        assert.notEqual(
            await readFile(path.join(fixture.projectRoot, ...managedPath.split("/")), "utf8"),
            simulatedOldSource
        );
        const afterUpdate = await AgentPack.readAgentPackProjectStatus(fixture.projectRoot);
        assert.equal(afterUpdate.status, "current");
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack update migrates receipt-owned unprefixed skills to gmloop-prefixed names", async () => {
    const fixture = await createGameProjectFixture();
    try {
        const oldRelativePath = ".agents/skills/game-design/SKILL.md";
        const oldSource = "---\nname: game-design\ndescription: Previous packaged skill.\n---\n";
        const oldTargetPath = path.join(fixture.projectRoot, ...oldRelativePath.split("/"));
        await mkdir(path.dirname(oldTargetPath), { recursive: true });
        await writeFile(oldTargetPath, oldSource, "utf8");
        await mkdir(path.join(fixture.projectRoot, ".gmloop"), { recursive: true });
        await writeFile(
            path.join(fixture.projectRoot, ".gmloop", "agent-pack.json"),
            `${JSON.stringify(createReceiptFixture({ files: { [oldRelativePath]: hashText(oldSource) }, version: "0.0.0" }), null, 2)}\n`,
            "utf8"
        );

        const result = await AgentPack.initializeAgentPack(fixture.projectRoot);

        assert.ok(result.removed.includes(oldRelativePath));
        assert.ok(result.added.includes(".agents/skills/gmloop-game-design/SKILL.md"));
        await assert.rejects(() => readFile(oldTargetPath, "utf8"), /ENOENT/u);
    } finally {
        await fixture.cleanup();
    }
});

void test("agent pack rejects projects without a yyp and unsafe receipt paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gmloop-agent-pack-invalid-"));
    try {
        await assert.rejects(() => AgentPack.initializeAgentPack(directory), /containing a \.yyp file/u);
        await writeFile(path.join(directory, "Fixture.yyp"), "{}\n", "utf8");
        await mkdir(path.join(directory, ".gmloop"), { recursive: true });
        await writeFile(
            path.join(directory, ".gmloop", "agent-pack.json"),
            `${JSON.stringify({ conflicts: [], files: { "../../outside": "hash" }, package: "@gmloop/agent-pack", version: "0.0.0" })}\n`,
            "utf8"
        );
        await assert.rejects(() => AgentPack.initializeAgentPack(directory), /safe project-relative paths/u);
    } finally {
        await rm(directory, { force: true, recursive: true });
    }
});

// ---------------------------------------------------------------------------
// Receipt comparison helpers (exposed via __agentPackTest__)
// ---------------------------------------------------------------------------

const { agentPackReceiptsMatch, areStringArraysEqual, areStringRecordsEqual } = __agentPackTest__;

function createReceiptFixture(
    overrides: Partial<{ conflicts: ReadonlyArray<string>; files: Record<string, string>; version: string }> = {}
): AgentPackReceiptFixture {
    return Object.freeze({
        conflicts: Object.freeze([...(overrides.conflicts ?? [])]),
        files: Object.freeze({ ...overrides.files }),
        package: "@gmloop/agent-pack",
        version: overrides.version ?? "1.0.0"
    });
}

void test("areStringArraysEqual returns true for two references to the same array", () => {
    const shared: ReadonlyArray<string> = Object.freeze(["alpha", "beta", "gamma"]);
    assert.equal(areStringArraysEqual(shared, shared), true);
});

void test("areStringArraysEqual returns true for arrays with the same length and ordered entries", () => {
    assert.equal(areStringArraysEqual(["a", "b"], ["a", "b"]), true);
    assert.equal(areStringArraysEqual([], []), true);
});

void test("areStringArraysEqual returns false when lengths differ", () => {
    assert.equal(areStringArraysEqual(["a"], ["a", "b"]), false);
});

void test("areStringArraysEqual returns false when entries differ at any position", () => {
    assert.equal(areStringArraysEqual(["a", "b"], ["a", "c"]), false);
    assert.equal(areStringArraysEqual(["a", "b"], ["b", "a"]), false);
});

void test("areStringRecordsEqual returns true for two references to the same record", () => {
    const shared: Readonly<Record<string, string>> = Object.freeze({ alpha: "1", beta: "2" });
    assert.equal(areStringRecordsEqual(shared, shared), true);
});

void test("areStringRecordsEqual returns true for records with identical keys and values", () => {
    assert.equal(areStringRecordsEqual({ alpha: "1", beta: "2" }, { alpha: "1", beta: "2" }), true);
    assert.equal(areStringRecordsEqual({}, {}), true);
});

void test("areStringRecordsEqual returns false when key counts differ", () => {
    assert.equal(areStringRecordsEqual({ alpha: "1" }, { alpha: "1", beta: "2" }), false);
});

void test("areStringRecordsEqual returns false when any value differs", () => {
    assert.equal(areStringRecordsEqual({ alpha: "1", beta: "2" }, { alpha: "1", beta: "3" }), false);
});

void test("areStringRecordsEqual ignores insertion-order differences for matching keys", () => {
    // The matcher only checks key set + per-key values, mirroring what the
    // previous JSON.stringify comparison produced while avoiding the
    // serialisation round-trip entirely.
    assert.equal(areStringRecordsEqual({ alpha: "1", beta: "2" }, { beta: "2", alpha: "1" }), true);
});

void test("agentPackReceiptsMatch returns false when the left receipt is null", () => {
    assert.equal(agentPackReceiptsMatch(null, createReceiptFixture()), false);
});

void test("agentPackReceiptsMatch returns true for structurally identical receipts", () => {
    const left = createReceiptFixture({
        conflicts: ["AGENTS.md"],
        files: { ".agents/skills/foo/SKILL.md": "abc123" },
        version: "1.2.3"
    });
    const right = createReceiptFixture({
        conflicts: ["AGENTS.md"],
        files: { ".agents/skills/foo/SKILL.md": "abc123" },
        version: "1.2.3"
    });
    assert.equal(agentPackReceiptsMatch(left, right), true);
});

void test("agentPackReceiptsMatch returns false when the version differs", () => {
    const left = createReceiptFixture({ version: "1.0.0" });
    const right = createReceiptFixture({ version: "1.0.1" });
    assert.equal(agentPackReceiptsMatch(left, right), false);
});

void test("agentPackReceiptsMatch returns false when conflicts differ", () => {
    const left = createReceiptFixture({ conflicts: ["AGENTS.md"] });
    const right = createReceiptFixture({ conflicts: ["scripts/player.gml"] });
    assert.equal(agentPackReceiptsMatch(left, right), false);
});

void test("agentPackReceiptsMatch returns false when a file hash differs", () => {
    const left = createReceiptFixture({ files: { "AGENTS.md": "hash-a" } });
    const right = createReceiptFixture({ files: { "AGENTS.md": "hash-b" } });
    assert.equal(agentPackReceiptsMatch(left, right), false);
});

void test("agentPackReceiptsMatch returns false when the file key sets differ", () => {
    const left = createReceiptFixture({ files: { "AGENTS.md": "hash" } });
    const right = createReceiptFixture({ files: { ".agents/skills/foo/SKILL.md": "hash" } });
    assert.equal(agentPackReceiptsMatch(left, right), false);
});
