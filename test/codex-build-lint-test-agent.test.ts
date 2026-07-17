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

const REQUIRED_ALLOWED_GMLOOP_TOOLS = Object.freeze(["gmloop_lint"]);

const REQUIRED_FORBIDDEN_MCP_SERVERS = Object.freeze(["gm-cli", "playwright", "lsp", "node_repl", "computer-use"]);

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
    "exit or result status",
    "exact stdout/stderr failure excerpts",
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
    "run exactly that command",
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

void test("build-lint-test agent TOML declares a gmloop allowlist of exactly gmloop_lint", async () => {
    const roleTomlText = await readFile(buildLintTestTomlPath, "utf8");

    assert.equal(
        roleTomlText.includes("[mcp_servers.gmloop]"),
        true,
        "Expected build-lint-test.toml to declare [mcp_servers.gmloop]."
    );

    const gmloopBody = findTableBody(roleTomlText, "mcp_servers.gmloop");
    assert.equal(gmloopBody.includes('command = "gmloop"'), true);
    assert.equal(gmloopBody.includes('args = ["mcp"]'), true);
    // The [mcp_servers.gmloop.env] sub-table sits on its own line in this
    // role file, so it is not part of the parent body's slice above; assert
    // it against the full role TOML.
    assert.equal(
        roleTomlText.includes("[mcp_servers.gmloop.env]") &&
            roleTomlText.includes('GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS = "true"'),
        true,
        "Expected [mcp_servers.gmloop.env] to expose the internal gmloop MCP tooling for the lint MCP surface."
    );

    const enabledToolsMatch = /enabled_tools\s*=\s*\[([\s\S]*?)\]/.exec(gmloopBody);
    assert.notEqual(
        enabledToolsMatch,
        null,
        "Expected [mcp_servers.gmloop] to declare enabled_tools as a literal list."
    );
    const enabledToolsBlock = enabledToolsMatch?.[1] ?? "";
    for (const expectedTool of REQUIRED_ALLOWED_GMLOOP_TOOLS) {
        assert.equal(
            enabledToolsBlock.includes(`"${expectedTool}"`),
            true,
            `Expected gmloop enabled_tools to include "${expectedTool}".`
        );
    }

    // enabled_tools must contain *only* the read-only gmloop_lint tool. The
    // role spec says the gmloop MCP surface is for lint MCP reads only;
    // every other gmloop_lint-shaped tool name and the write-shape of the
    // enabled_tools list is forbidden.
    for (const forbiddenTool of FORBIDDEN_TOOL_NAMES) {
        assert.equal(
            enabledToolsBlock.includes(`"${forbiddenTool}"`),
            false,
            `Expected gmloop enabled_tools to not include "${forbiddenTool}".`
        );
    }

    // `gmloop_lint --write` would mutate the repo. The enabled_tools entry
    // is the bare tool name, and the agent description makes clear that
    // build/test commands always go through the shell, not through any
    // GMLoop tool. The whole role TOML must not advertise gmloop_lint --write.
    assert.equal(
        roleTomlText.includes("gmloop_lint --write") || roleTomlText.includes("gmloop_lint --write=true"),
        false,
        "Expected build-lint-test.toml to never advertise gmloop_lint --write."
    );
});

void test("build-lint-test agent TOML disables every required non-target MCP server with a valid stdio transport", async () => {
    const roleTomlText = await readFile(buildLintTestTomlPath, "utf8");

    for (const serverName of REQUIRED_FORBIDDEN_MCP_SERVERS) {
        const header = `[mcp_servers.${serverName}]`;
        assert.equal(
            roleTomlText.includes(header),
            true,
            `Expected build-lint-test.toml to declare ${header} so the inherited server is explicitly disabled.`
        );

        const body = findTableBody(roleTomlText, `mcp_servers.${serverName}`);
        assert.equal(
            body.includes('command = "false"'),
            true,
            `Expected ${header} table to declare a valid fail-closed stdio transport (command = "false").`
        );
        assert.equal(
            body.includes("args = []"),
            true,
            `Expected ${header} table to declare args = [] so the disabled transport is schema-valid.`
        );
        assert.equal(
            body.includes("enabled = false"),
            true,
            `Expected ${header} table to set enabled = false so the reporter cannot reach ${serverName}.`
        );
    }

    // No enable paths should sneak past the `enabled = false` rows: the agent
    // must never see a tool entry on a forbidden server, in any other MCP
    // server table, or in any developer-instructions example.
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
        instructions.includes("without --write") || instructions.includes("without the write"),
        true,
        "Expected build-lint-test developer instructions to instruct calling gmloop_lint without --write."
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

void test("docs describe the intentional shell path for build/tests, lint MCP limitation, generated-artifact scope, network restriction, and exact-output reporting", async () => {
    const docsText = await readFile(docsPath, "utf8");
    const lowerDocs = docsText.toLowerCase();

    // Intentional shell path for repository build and tests (not via GMLoop tools).
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
        lowerDocs.includes("repository build and tests always go through the shell"),
        true,
        "Expected docs to make clear that repository build and tests run through the shell, not any GMLoop tool."
    );

    // Lint MCP limitation: only gmloop_lint (read), no --write, no other lint-shaped tool.
    assert.equal(docsText.includes("gmloop_lint"), true, "Expected docs to mention the gmloop_lint MCP tool.");
    assert.equal(
        lowerDocs.includes("without --write") ||
            lowerDocs.includes("without the write") ||
            lowerDocs.includes("without its write"),
        true,
        "Expected docs to call out that gmloop_lint must be called without --write."
    );
    assert.equal(
        lowerDocs.includes("must call it without") || lowerDocs.includes("called without"),
        true,
        "Expected docs to spell out the no-write lint MCP limitation."
    );

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
        lowerDocs.includes("exact stdout/stderr failure excerpts") || lowerDocs.includes("exact stdout/stderr"),
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
