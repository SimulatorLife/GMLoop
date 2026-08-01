import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The compiled artifact lives at test/dist/*.test.js, so `..` of `import.meta.url`
// resolves to the repository root.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const buildLintTestTomlPath = path.join(repoRoot, ".codex", "agents", "build-lint-test.toml");
const configTomlPath = path.join(repoRoot, ".codex", "config.toml");
const docsPath = path.join(repoRoot, "docs", "codex-build-lint-test-agent.md");

const REQUIRED_FAIL_CLOSED_MCP_SERVERS = Object.freeze([
    "gmloop",
    "gm-cli",
    "playwright",
    "lsp",
    "node_repl",
    "computer-use"
]);

// Tools the agent must never have available, regardless of which MCP server
// they would be exposed on, because the agent is strictly a reporter for
// shell-driven build/lint/test runs.
const FORBIDDEN_TOOL_NAMES = Object.freeze([
    // gmloop mutation / codemod / live-reload / runtime / watcher tools.
    "gmloop_format",
    "gmloop_refactor",
    "gmloop_fix",
    "gmloop_watch",
    "gmloop_live_reload_build",
    "gmloop_live_reload_prepare",
    "gmloop_live_reload_session",
    "gmloop_live_reload_wait_for_patch",
    "gmloop_project_rename",
    // gm-cli write-side tools.
    "resource_create",
    "resource_delete",
    "resource_set",
    "room_instance_create",
    "room_item_delete",
    "room_layer_create",
    "sprite_addframe",
    "sound_setfile",
    "font_setfile",
    "tileset_create",
    "project_rename",
    "options_set",
    // Playwright primitive tools that would let the agent escape its shell-only role.
    "browser_run_code_unsafe",
    "browser_evaluate"
]);

const REQUIRED_REPORTER_KEY_PHRASES = Object.freeze([
    "do not edit",
    "do not run git",
    "do not install",
    "do not spawn",
    "exit status",
    "exact verbatim stdout/stderr failure excerpts",
    "warnings unless the orchestrator",
    "do not rerun"
] as const);

const REQUIRED_SAFE_COMMAND_PHRASES = Object.freeze([
    "pnpm run build:ts",
    "pnpm run build",
    "pnpm run lint:quiet",
    "pnpm run test:quiet",
    "pnpm run test:compiled",
    "pnpm run test"
] as const);

const REQUIRED_RUN_ONLY_ASSIGNED_PHRASES = Object.freeze([
    "run exactly those command(s)",
    "do not invent commands",
    "do not fix anything",
    "do not rerun"
] as const);

/**
 * Locate the TOML table body for `[sectionName]` in a known-good TOML file by
 * finding the section header index, then returning the substring between that
 * header and the next `[`-prefixed header at the start of a line. This is a
 * targeted contract assertion against the role file's known structure; it is
 * not a general TOML parser.
 */
function findTableBody(sourceText: string, sectionName: string): string {
    const headerMarker = `[${sectionName}]`;
    const startIndex = sourceText.indexOf(headerMarker);
    assert.notEqual(startIndex, -1, `Expected section [${sectionName}] in the role TOML to exist.`);

    const bodyStart = sourceText.indexOf("\n", startIndex);
    assert.notEqual(bodyStart, -1, `Expected section [${sectionName}] to be terminated by a newline.`);

    const afterHeader = sourceText.slice(bodyStart + 1);
    const nextSectionOffset = afterHeader.indexOf("\n[");
    if (nextSectionOffset === -1) {
        return afterHeader;
    }
    return afterHeader.slice(0, nextSectionOffset);
}

/**
 * Find the substring of `sourceText` that lies between the start of the
 * developer_instructions literal block (after the triple quote) and the
 * closing triple quote.
 */
function findDeveloperInstructions(sourceText: string): string {
    const instructionsMatch = /developer_instructions\s*=\s*"""([\s\S]*?)"""/.exec(sourceText);
    assert.notEqual(
        instructionsMatch,
        null,
        "Expected the role TOML to define developer_instructions as a literal block."
    );
    return instructionsMatch?.[1] ?? "";
}

void test("build-lint-test agent TOML pins model, reasoning effort, sandbox, and nicknames", async () => {
    const roleTomlText = await readFile(buildLintTestTomlPath, "utf8");

    assert.equal(
        roleTomlText.includes(`name = "build-lint-test"`),
        true,
        'Expected build-lint-test.toml to declare name = "build-lint-test".'
    );
    assert.equal(
        roleTomlText.includes(`model = "gpt-5.4-mini"`),
        true,
        'Expected build-lint-test.toml to use model = "gpt-5.4-mini" exactly.'
    );
    assert.equal(
        roleTomlText.includes(`model_reasoning_effort = "medium"`),
        true,
        'Expected build-lint-test.toml to set model_reasoning_effort = "medium" exactly.'
    );
    assert.equal(
        roleTomlText.includes(`sandbox_mode = "workspace-write"`),
        true,
        'Expected build-lint-test.toml to set sandbox_mode = "workspace-write".'
    );
    assert.equal(
        roleTomlText.includes("[sandbox_workspace_write]"),
        true,
        "Expected build-lint-test.toml to declare [sandbox_workspace_write] so the workspace-write sandbox is tunable per role."
    );
    assert.equal(
        roleTomlText.includes("network_access = false"),
        true,
        "Expected [sandbox_workspace_write] to set network_access = false so the reporter cannot reach the network."
    );
    assert.equal(
        roleTomlText.includes('nickname_candidates = ["BuildProbe", "LintProbe", "TestProbe"]'),
        true,
        'Expected build-lint-test.toml to declare nickname_candidates = ["BuildProbe", "LintProbe", "TestProbe"].'
    );

    // The role must rely on the user's "gpt-5.4-mini" model directly and must
    // not pin a MiniMax / MiniMax-M3 model_provider.
    assert.equal(
        roleTomlText.includes("model_provider"),
        false,
        "Expected build-lint-test.toml to not declare model_provider."
    );
    assert.equal(roleTomlText.includes("MiniMax"), false, "Expected build-lint-test.toml to not reference MiniMax.");
});

void test("build-lint-test agent TOML fail-closes every inherited MCP server", async () => {
    const roleTomlText = await readFile(buildLintTestTomlPath, "utf8");

    for (const serverName of REQUIRED_FAIL_CLOSED_MCP_SERVERS) {
        const header = `[mcp_servers.${serverName}]`;
        assert.equal(
            roleTomlText.includes(header),
            true,
            `Expected build-lint-test.toml to declare ${header} so inherited MCP access is explicitly disabled.`
        );

        const body = findTableBody(roleTomlText, `mcp_servers.${serverName}`);
        assert.equal(body.includes('command = "false"'), true, `Expected ${header} to use command = "false".`);
        assert.equal(body.includes("args = []"), true, `Expected ${header} to use args = [].`);
        assert.equal(body.includes("enabled = false"), true, `Expected ${header} to set enabled = false.`);
        assert.equal(body.includes("enabled_tools"), false, `Expected ${header} to have no enabled_tools.`);
    }

    assert.equal(
        roleTomlText.includes("enabled_tools"),
        false,
        "Expected build-lint-test.toml to define no MCP tool allowlists."
    );
    assert.equal(
        roleTomlText.includes("[mcp_servers.gmloop.env]"),
        false,
        "Expected build-lint-test.toml to define no gmloop environment table."
    );
    assert.equal(
        roleTomlText.includes("GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS"),
        false,
        "Expected build-lint-test.toml to omit the internal MCP exposure environment variable."
    );
    assert.equal(
        roleTomlText.includes("gmloop_lint"),
        false,
        "Expected build-lint-test.toml to contain no MCP lint tool name."
    );

    for (const forbiddenTool of FORBIDDEN_TOOL_NAMES) {
        assert.equal(
            roleTomlText.includes(`"${forbiddenTool}"`),
            false,
            `Expected build-lint-test.toml to never enable the forbidden tool ${forbiddenTool}.`
        );
    }
});

void test("build-lint-test developer instructions enforce the strict reporter contract", async () => {
    const roleTomlText = await readFile(buildLintTestTomlPath, "utf8");
    const instructions = findDeveloperInstructions(roleTomlText).toLowerCase();

    for (const phrase of REQUIRED_REPORTER_KEY_PHRASES) {
        assert.equal(
            instructions.includes(phrase),
            true,
            `Expected build-lint-test developer instructions to mention "${phrase}" (case-insensitive).`
        );
    }

    for (const phrase of REQUIRED_SAFE_COMMAND_PHRASES) {
        assert.equal(
            instructions.includes(phrase),
            true,
            `Expected build-lint-test developer instructions to mention the safe command "${phrase}".`
        );
    }

    for (const phrase of REQUIRED_RUN_ONLY_ASSIGNED_PHRASES) {
        assert.equal(
            instructions.includes(phrase),
            true,
            `Expected build-lint-test developer instructions to enforce "${phrase}" so the agent only runs the assigned command.`
        );
    }

    // The agent must never suggest re-running commands, re-trying, or chaining
    // extra steps when reporting build/lint/test output.
    assert.equal(
        instructions.includes("do not chain extra commands"),
        true,
        "Expected build-lint-test developer instructions to forbid chaining extra commands."
    );
    assert.equal(
        instructions.includes("apply_patch"),
        true,
        "Expected build-lint-test developer instructions to forbid apply_patch."
    );
    assert.equal(
        instructions.includes("do not summarize, paraphrase"),
        true,
        "Expected build-lint-test developer instructions to forbid summarizing or paraphrasing output."
    );
    assert.equal(
        instructions.includes("no mcp tools are available or permitted"),
        true,
        "Expected build-lint-test developer instructions to make MCP access unavailable and forbidden."
    );
    assert.equal(
        instructions.includes("repository build, lint, and test work uses only the assigned shell command"),
        true,
        "Expected build-lint-test developer instructions to require the assigned shell command for repository work."
    );
});

void test(".codex/config.toml registers the build-lint-test agent and points to its config file", async () => {
    const configTomlText = await readFile(configTomlPath, "utf8");

    assert.equal(
        configTomlText.includes("[agents.build-lint-test]"),
        true,
        "Expected .codex/config.toml to declare [agents.build-lint-test]."
    );
    assert.equal(
        configTomlText.includes(`config_file = "./agents/build-lint-test.toml"`),
        true,
        "Expected .codex/config.toml to point [agents.build-lint-test] at ./agents/build-lint-test.toml."
    );
    assert.equal(
        configTomlText.toLowerCase().includes("strict gmloop build, lint, and test reporter"),
        true,
        "Expected [agents.build-lint-test] description to match the strict reporter contract."
    );

    const block = findTableBody(configTomlText, "agents.build-lint-test");
    assert.equal(
        block.includes("description ="),
        true,
        "Expected [agents.build-lint-test] entry to declare a description."
    );
    assert.equal(
        block.includes(`config_file = "./agents/build-lint-test.toml"`),
        true,
        'Expected [agents.build-lint-test] entry to declare config_file = "./agents/build-lint-test.toml".'
    );

    // Existing agent registrations and global agent limits must not change.
    assert.equal(configTomlText.includes("[agents.explorer]"), true);
    assert.equal(configTomlText.includes("[agents.worker]"), true);
    assert.equal(configTomlText.includes("[agents.validator]"), true);
    assert.equal(configTomlText.includes("[agents.tester]"), true);
    assert.equal(configTomlText.includes("max_threads = 3"), true);
    assert.equal(configTomlText.includes("max_depth = 1"), true);
});

void test("docs describe the zero-MCP shell-only reporter contract", async () => {
    const docsText = await readFile(docsPath, "utf8");
    const lowerDocs = docsText.toLowerCase();
    const normalizedDocs = lowerDocs.replaceAll(/\s+/g, " ");

    // Repository build, lint, and tests use the assigned pnpm command, not MCP.
    assert.equal(
        lowerDocs.includes("pnpm run build:ts"),
        true,
        "Expected docs to list pnpm run build:ts as one of the safe shell commands."
    );
    assert.equal(
        lowerDocs.includes("pnpm run test"),
        true,
        "Expected docs to list pnpm run test as one of the safe shell commands."
    );
    assert.equal(
        normalizedDocs.includes("repository build, lint, and tests always go through the assigned shell command") ||
            normalizedDocs.includes("repository build, lint, and tests run through the assigned `pnpm` command"),
        true,
        "Expected docs to make clear that repository build, lint, and tests run through the assigned shell command."
    );
    assert.equal(
        lowerDocs.includes("not gmloop mcp"),
        true,
        "Expected docs to make clear that repository checks do not use GMLoop MCP."
    );
    assert.equal(
        normalizedDocs.includes("zero mcp servers are reachable") &&
            normalizedDocs.includes("every inherited mcp table is explicitly disabled"),
        true,
        "Expected docs to describe the zero-MCP fail-closed inheritance contract."
    );
    assert.equal(
        normalizedDocs.includes("none enabled; every inherited mcp table is disabled"),
        true,
        "Expected docs configuration table to state that no MCP server is enabled."
    );
    assert.equal(docsText.includes("gmloop_lint"), false, "Expected docs to contain no MCP lint tool name.");

    // Generated-artifact scope: workspace-write so dist/, cache, and test artifacts can populate.
    assert.equal(
        lowerDocs.includes("workspace-write") &&
            (lowerDocs.includes("dist/") ||
                lowerDocs.includes("dist") ||
                lowerDocs.includes("artifact directories") ||
                lowerDocs.includes("artifact")),
        true,
        "Expected docs to describe workspace-write as the scope for normal generated build, lint, and test artifacts."
    );

    // Network restriction: disabled at the sandbox boundary.
    assert.equal(
        lowerDocs.includes("network access is disabled") || lowerDocs.includes("network is disabled"),
        true,
        "Expected docs to describe network access being disabled at the sandbox boundary."
    );
    assert.equal(
        lowerDocs.includes("no dependency or network activity") || lowerDocs.includes("disable the network"),
        true,
        "Expected docs to enumerate the no-dependency / no-network stance."
    );

    // Exact-output-only reporting: failure excerpts verbatim, warnings omitted unless asked.
    assert.equal(
        normalizedDocs.includes("exact verbatim stdout/stderr failure excerpts"),
        true,
        "Expected docs to describe exact-output-only reporting."
    );
    assert.equal(
        lowerDocs.includes("warnings are omitted") ||
            lowerDocs.includes("omit warnings") ||
            lowerDocs.includes("warnings only when the orchestrator"),
        true,
        "Expected docs to call out that warnings are omitted unless explicitly requested."
    );
});
