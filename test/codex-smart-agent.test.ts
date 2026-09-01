import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const smartAgentTomlPath = path.join(repoRoot, ".codex", "agents", "smart.toml");
const configTomlPath = path.join(repoRoot, ".codex", "config.toml");
const docsPath = path.join(repoRoot, "docs", "codex-smart-agent.md");

function findTableBody(sourceText: string, sectionName: string): string {
    const headerMarker = `[${sectionName}]`;
    const startIndex = sourceText.indexOf(headerMarker);
    assert.notEqual(startIndex, -1, `Expected section [${sectionName}] to exist.`);

    const bodyStart = sourceText.indexOf("\n", startIndex);
    assert.notEqual(bodyStart, -1, `Expected section [${sectionName}] to end with a newline.`);

    const afterHeader = sourceText.slice(bodyStart + 1);
    const nextSectionOffset = afterHeader.indexOf("\n[");
    return nextSectionOffset === -1 ? afterHeader : afterHeader.slice(0, nextSectionOffset);
}

function findDeveloperInstructions(sourceText: string): string {
    const instructionsMatch = /developer_instructions\s*=\s*"""([\s\S]*?)"""/.exec(sourceText);
    assert.notEqual(instructionsMatch, null, "Expected smart.toml to define developer_instructions.");
    return instructionsMatch?.[1] ?? "";
}

void test("smart agent pins GPT-5.6 Sol, high reasoning, and sparse-use guidance", async () => {
    const roleText = await readFile(smartAgentTomlPath, "utf8");
    const lowerRoleText = roleText.toLowerCase();

    assert.equal(roleText.includes('name = "smart"'), true);
    assert.equal(roleText.includes('model = "gpt-5.6-sol"'), true);
    assert.equal(roleText.includes('model_reasoning_effort = "high"'), true);
    assert.equal(roleText.includes('nickname_candidates = ["SolSmart", "DeepSolve", "SolExpert"]'), true);
    assert.equal(roleText.includes("model_provider"), false);
    assert.equal(lowerRoleText.includes("costly"), true);
    assert.equal(lowerRoleText.includes("complex"), true);
    assert.equal(lowerRoleText.includes("use sparingly"), true);
});

void test("smart agent inherits capabilities while disabling child-agent creation", async () => {
    const roleText = await readFile(smartAgentTomlPath, "utf8");
    const lowerRoleText = roleText.toLowerCase();

    assert.equal(roleText.includes("[agents]\nmax_depth = 0"), true);
    assert.equal(roleText.includes("[features]\nmulti_agent = false\nenable_fanout = false"), true);

    // No capability restrictions should be introduced by this role.
    assert.equal(roleText.includes("sandbox_mode"), false);
    assert.equal(roleText.includes("approval_policy"), false);
    assert.equal(roleText.includes("[mcp_servers."), false);
    assert.equal(roleText.includes("enabled_tools"), false);
    assert.equal(lowerRoleText.includes("inherit the orchestrator's full tool"), true);
    assert.equal(lowerRoleText.includes("full shell, filesystem, approval, and network"), true);

    const instructions = findDeveloperInstructions(roleText).toLowerCase();
    for (const phrase of [
        "do not spawn",
        "spawn_agent",
        "spawn_agents_on_csv",
        "fan out",
        "child-agent",
        "do not use any subagent or delegation capability"
    ]) {
        assert.equal(instructions.includes(phrase), true, `Expected no-spawn instruction to contain "${phrase}".`);
    }
});

void test(".codex/config.toml registers smart without changing existing agent limits", async () => {
    const configText = await readFile(configTomlPath, "utf8");
    const smartBlock = findTableBody(configText, "agents.smart");

    assert.equal(smartBlock.includes("description ="), true);
    assert.equal(smartBlock.includes('config_file = "./agents/smart.toml"'), true);
    assert.equal(configText.includes("Costly GPT-5.6 Sol specialist"), true);

    for (const existingAgent of ["explorer", "worker", "validator", "tester", "build-lint-test"]) {
        assert.equal(configText.includes(`[agents.${existingAgent}]`), true);
    }
    assert.equal(configText.includes("max_threads = 3"), true);
    assert.equal(configText.includes("max_depth = 1"), true);
});

void test("smart agent docs describe cost, inherited capabilities, and the no-spawn boundary", async () => {
    const docsText = await readFile(docsPath, "utf8");
    const normalizedDocs = docsText.toLowerCase().replaceAll(/\s+/g, " ");

    for (const phrase of [
        "gpt-5.6-sol",
        "model_reasoning_effort",
        "high reasoning",
        "costly",
        "use it sparingly",
        "complex",
        "inherits the main/orchestrator",
        "full shell, filesystem, mcp, approval, and network capabilities",
        "max_depth = 0",
        "multi_agent = false",
        "enable_fanout = false",
        "cannot spawn subagents"
    ]) {
        assert.equal(normalizedDocs.includes(phrase), true, `Expected smart docs to contain "${phrase}".`);
    }

    assert.equal(normalizedDocs.includes("sandbox_mode"), true);
    assert.equal(normalizedDocs.includes("approval_policy"), true);
    assert.equal(normalizedDocs.includes("mcp_servers"), true);
});
