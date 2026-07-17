import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The compiled artifact lives at test/dist/*.test.js, so `..` of `import.meta.url`
// resolves to the repository root.
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const testerTomlPath = path.join(repoRoot, ".codex", "agents", "tester.toml");
const configTomlPath = path.join(repoRoot, ".codex", "config.toml");

const REQUIRED_GMLOOP_TOOLS = Object.freeze([
    "gmloop_project_inspect",
    "gmloop_project_validate",
    "gmloop_live_reload_build",
    "gmloop_live_reload_prepare",
    "gmloop_live_reload_session",
    "gmloop_live_reload_wait_for_patch",
    "gmloop_runner_lifecycle",
    "gmloop_runner_logs",
    "gmloop_runner_room_current",
    "gmloop_runner_status",
    "gmloop_runtime_inspect",
    "gmloop_runtime_instances",
    "gmloop_runtime_logs",
    "gmloop_runtime_state"
]);

const REQUIRED_GM_CLI_TOOLS = Object.freeze([
    "status",
    "resource_list",
    "resource_info",
    "room_list",
    "room_item_list",
    "room_layer_list"
]);

const REQUIRED_PLAYWRIGHT_TOOLS = Object.freeze([
    "browser_navigate",
    "browser_tabs",
    "browser_snapshot",
    "browser_take_screenshot",
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_press_key",
    "browser_wait_for",
    "browser_console_messages",
    "browser_network_requests",
    "browser_network_request",
    "browser_find",
    "browser_hover",
    "browser_select_option",
    "browser_drag",
    "browser_handle_dialog",
    "browser_resize",
    "browser_close"
]);

const FORBIDDEN_TOOLS = Object.freeze([
    "browser_evaluate",
    "browser_run_code_unsafe",
    "browser_file_upload",
    "browser_drop",
    "browser_run_code_playwright"
]);

const FORBIDDEN_GMLOOP_MUTATION_TOOLS = Object.freeze([
    "gmloop_format",
    "gmloop_lint",
    "gmloop_refactor",
    "gmloop_resource_create",
    "gmloop_resource_delete",
    "gmloop_resource_set",
    "gmloop_room_instance_create",
    "gmloop_room_instance_delete",
    "gmloop_room_asset_create",
    "gmloop_room_item_delete",
    "gmloop_room_layer_create",
    "gmloop_room_layer_delete",
    "gmloop_sprite_addframe",
    "gmloop_sprite_deleteframe",
    "gmloop_object_event_add",
    "gmloop_object_event_delete",
    "gmloop_object_event_update",
    "gmloop_script_add",
    "gmloop_script_remove",
    "gmloop_script_update",
    "gmloop_sound_setfile",
    "gmloop_font_setfile",
    "gmloop_tileset_create",
    "gmloop_tileset_delete",
    "gmloop_options_set",
    "gmloop_audiogroup_create",
    "gmloop_audiogroup_delete",
    "gmloop_audiogroup_set",
    "gmloop_texturegroup_create",
    "gmloop_texturegroup_delete",
    "gmloop_texturegroup_set",
    "gmloop_project_rename",
    "gmloop_runner_clear_logs",
    "gmloop_runner_room_set",
    "gmloop_runtime_set",
    "gmloop_runtime_call",
    "gmloop_watch",
    "gmloop_collect_stats",
    "gmloop_fix"
]);

const FORBIDDEN_GM_CLI_MUTATION_TOOLS = Object.freeze([
    "resource_create",
    "resource_delete",
    "resource_set",
    "room_instance_create",
    "room_instance_delete",
    "room_item_delete",
    "room_layer_create",
    "room_layer_delete",
    "room_layer_tiles_set",
    "room_asset_create",
    "sprite_addframe",
    "sprite_deleteframe",
    "sound_setfile",
    "font_setfile",
    "tileset_create",
    "tileset_delete",
    "project_rename",
    "path_addpoint",
    "path_deletepoint",
    "options_set"
]);

/**
 * Locate the TOML table body for `[sectionName]` in a known-good TOML file by
 * finding the section header index, then returning the substring between that
 * header and the next `[`-prefixed header at the start of a line. This is a
 * targeted contract assertion against the tester file's known structure; it is
 * not a general TOML parser.
 */
function findTableBody(sourceText: string, sectionName: string): string {
    const headerMarker = `[${sectionName}]`;
    const startIndex = sourceText.indexOf(headerMarker);
    assert.notEqual(startIndex, -1, `Expected section [${sectionName}] in tester.toml to exist.`);

    const bodyStart = sourceText.indexOf("\n", startIndex);
    assert.notEqual(bodyStart, -1, `Expected section [${sectionName}] to be terminated by a newline.`);

    const afterHeader = sourceText.slice(bodyStart + 1);
    const nextSectionOffset = afterHeader.indexOf("\n[");
    if (nextSectionOffset === -1) {
        return afterHeader;
    }
    return afterHeader.slice(0, nextSectionOffset);
}

function assertEnabledToolsContainAll(bodyText: string, expectedTools: ReadonlyArray<string>): void {
    for (const expectedTool of expectedTools) {
        const tokenisedEntry = `"${expectedTool}"`;
        assert.equal(
            bodyText.includes(tokenisedEntry),
            true,
            `Expected tester.toml allowlist to include ${tokenisedEntry}.`
        );
    }
}

function assertEnabledToolsRejectAll(bodyText: string, forbiddenTools: ReadonlyArray<string>): void {
    for (const forbiddenTool of forbiddenTools) {
        const tokenisedEntry = `"${forbiddenTool}"`;
        assert.equal(
            bodyText.includes(tokenisedEntry),
            false,
            `Expected tester.toml allowlist to exclude ${tokenisedEntry}.`
        );
    }
}

void test("tester agent TOML pins the orchestrator-directed model and read-only sandbox", async () => {
    const testerTomlText = await readFile(testerTomlPath, "utf8");

    assert.equal(testerTomlText.includes(`name = "tester"`), true, 'Expected tester.toml to declare name = "tester".');
    assert.equal(
        testerTomlText.includes(`model = "gpt-5.6-luna"`),
        true,
        'Expected tester.toml to use model = "gpt-5.6-luna".'
    );
    assert.equal(
        testerTomlText.includes(`model_reasoning_effort = "max"`),
        true,
        'Expected tester.toml to set model_reasoning_effort = "max".'
    );
    assert.equal(
        testerTomlText.includes(`sandbox_mode = "read-only"`),
        true,
        'Expected tester.toml to set sandbox_mode = "read-only".'
    );

    assert.equal(
        testerTomlText.includes("model_provider"),
        false,
        "Expected tester.toml to not declare model_provider."
    );
    assert.equal(testerTomlText.includes("MiniMax"), false, "Expected tester.toml to not reference MiniMax.");
});

void test("tester agent TOML configures the gmloop live-reload and runtime allowlist", async () => {
    const testerTomlText = await readFile(testerTomlPath, "utf8");

    assert.equal(
        testerTomlText.includes("[mcp_servers.gmloop]"),
        true,
        "Expected tester.toml to declare [mcp_servers.gmloop]."
    );
    const gmloopBody = findTableBody(testerTomlText, "mcp_servers.gmloop");
    assert.equal(gmloopBody.includes('command = "gmloop"'), true);
    assert.equal(gmloopBody.includes('args = ["mcp"]'), true);
    assertEnabledToolsContainAll(gmloopBody, REQUIRED_GMLOOP_TOOLS);
    assertEnabledToolsRejectAll(gmloopBody, FORBIDDEN_GMLOOP_MUTATION_TOOLS);
});

void test("tester agent TOML explicitly disables inherited non-target MCP servers", async () => {
    const testerTomlText = await readFile(testerTomlPath, "utf8");
    const disabledServers = ["lsp", "node_repl", "computer-use"] as const;

    for (const serverName of disabledServers) {
        const header = `[mcp_servers.${serverName}]`;
        assert.equal(
            testerTomlText.includes(header),
            true,
            `Expected tester.toml to declare ${header} so the inherited server is explicitly disabled.`
        );

        const body = findTableBody(testerTomlText, `mcp_servers.${serverName}`);
        assert.equal(
            body.includes("enabled = false"),
            true,
            `Expected ${header} table to set enabled = false so the tester cannot reach ${serverName}.`
        );
        assert.equal(
            body.includes('command = "false"'),
            true,
            `Expected ${header} table to declare a valid fail-closed stdio transport.`
        );
    }
});

void test("tester agent TOML configures the gm-cli read-only project/resource/room allowlist", async () => {
    const testerTomlText = await readFile(testerTomlPath, "utf8");

    assert.equal(
        testerTomlText.includes("[mcp_servers.gm-cli]"),
        true,
        "Expected tester.toml to declare [mcp_servers.gm-cli]."
    );

    const gmCliBody = findTableBody(testerTomlText, "mcp_servers.gm-cli");
    assert.equal(gmCliBody.includes('command = "gmloop"'), true);
    assert.equal(gmCliBody.includes('args = ["gm-cli", "mcp"]'), true);
    assertEnabledToolsContainAll(gmCliBody, REQUIRED_GM_CLI_TOOLS);
    assertEnabledToolsRejectAll(gmCliBody, FORBIDDEN_GM_CLI_MUTATION_TOOLS);
});

void test("tester agent TOML configures the Playwright navigate/interact allowlist and blocks unsafe primitives", async () => {
    const testerTomlText = await readFile(testerTomlPath, "utf8");

    assert.equal(
        testerTomlText.includes("[mcp_servers.playwright]"),
        true,
        "Expected tester.toml to declare [mcp_servers.playwright]."
    );

    const playwrightBody = findTableBody(testerTomlText, "mcp_servers.playwright");
    assert.equal(playwrightBody.includes('command = "npx"'), true);
    assert.equal(playwrightBody.includes('args = ["-y", "@playwright/mcp@latest"]'), true);
    assertEnabledToolsContainAll(playwrightBody, REQUIRED_PLAYWRIGHT_TOOLS);
    assertEnabledToolsRejectAll(playwrightBody, FORBIDDEN_TOOLS);

    // Unsafe primitives must not appear anywhere in the file: not in the
    // allowlist, and not as developer_instruction commentary that would imply
    // the agent should reach for them.
    for (const forbiddenTool of FORBIDDEN_TOOLS) {
        assert.equal(
            testerTomlText.includes(`"${forbiddenTool}"`),
            false,
            `Expected tester.toml to not enable the Playwright tool ${forbiddenTool}.`
        );
    }
});

void test("tester developer instructions forbid shell, code execution, and file mutation", async () => {
    const testerTomlText = await readFile(testerTomlPath, "utf8");
    const instructionsMatch = /developer_instructions\s*=\s*"""([\s\S]*?)"""/.exec(testerTomlText);
    assert.notEqual(
        instructionsMatch,
        null,
        "Expected tester.toml to define developer_instructions as a literal block."
    );

    const instructions = instructionsMatch?.[1] ?? "";
    const requiredPhrases = [
        "use only the mcp tools allowlisted",
        "do not use shell",
        "do not modify, stage, commit, push, or open pull requests",
        "build, start, and attach to the gamemaker runtime via the gmloop live reload tools",
        "use gm-cli tools only for read-only project, resource, room, and layer context",
        "browser_evaluate",
        "browser_run_code_unsafe"
    ] as const;

    for (const phrase of requiredPhrases) {
        const normalisedInstructions = instructions.toLowerCase();
        assert.equal(
            normalisedInstructions.includes(phrase),
            true,
            `Expected tester developer instructions to mention "${phrase}" (case-insensitive).`
        );
    }
});

void test(".codex/config.toml registers the tester agent and points to its config file", async () => {
    const configTomlText = await readFile(configTomlPath, "utf8");

    assert.equal(
        configTomlText.includes("[agents.tester]"),
        true,
        "Expected .codex/config.toml to declare [agents.tester]."
    );
    assert.equal(
        configTomlText.includes(`config_file = "./agents/tester.toml"`),
        true,
        "Expected .codex/config.toml to point [agents.tester] at ./agents/tester.toml."
    );
    assert.equal(
        configTomlText.includes("Read-only GameMaker runtime and browser tester"),
        true,
        "Expected [agents.tester] description to match the read-only tester contract."
    );

    const testerBlock = findTableBody(configTomlText, "agents.tester");
    assert.equal(
        testerBlock.includes(`description =`),
        true,
        "Expected [agents.tester] entry to declare a description."
    );
    assert.equal(
        testerBlock.includes(`config_file = "./agents/tester.toml"`),
        true,
        "Expected [agents.tester] entry to declare config_file = ./agents/tester.toml."
    );
});
